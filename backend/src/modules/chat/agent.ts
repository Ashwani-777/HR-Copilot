import { prisma } from '../../db.js';
import { getChatProvider } from '../../ai/index.js';
import type { AgentMessage, ChatProvider } from '../../ai/types.js';
import type { AuthContext } from '../../middleware/auth.js';
import { notFound } from '../../lib/errors.js';
import { todayIn } from '../../lib/time.js';
import { logger } from '../../logger.js';
import { CitationRegistry, type Citation } from './citations.js';
import { buildSystemPrompt } from './prompt.js';
import { findTool, toolDefinitions, type ToolContext } from './tools.js';

export const MAX_TOOL_ROUNDS = 4;
const MAX_CALLS_PER_ROUND = 6;
/** Chars of text held back per turn before we're sure it's an answer, not a pre-tool-call preamble. */
const PREAMBLE_HOLD_CHARS = 200;

export const NO_ANSWER = "I don't know — I couldn't find anything about that in your company's HR documents or data. Please check with HR.";

export type ChatEvent =
  | { event: 'tool'; data: { name: string; label: string } }
  | { event: 'token'; data: { text: string } }
  | { event: 'citations'; data: { citations: Citation[] } }
  | { event: 'done'; data: Record<string, never> };

export interface ChatInput {
  auth: AuthContext;
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  emit: (e: ChatEvent) => void;
  signal?: AbortSignal;
  provider?: ChatProvider;
}

/**
 * Text arriving during a turn is either the answer or a short preamble before tool calls
 * ("Let me check…"). The SSE contract puts all `tool` events before `token` events, so for models
 * that may write preambles we hold the first ~200 chars back; if a tool call follows, it's dropped.
 */
class TextGate {
  private buffer = '';
  private committed: boolean;
  private discarded = false;
  private emitted = false;

  constructor(
    private readonly emit: (text: string) => void,
    private readonly holdChars: number,
  ) {
    this.committed = holdChars === 0;
  }

  push = (delta: string): void => {
    if (this.discarded || !delta) return;
    if (this.committed) return this.send(delta);
    this.buffer += delta;
    if (this.buffer.length >= this.holdChars) {
      this.committed = true;
      this.send(this.buffer);
      this.buffer = '';
    }
  };

  private send(text: string): void {
    this.emitted = true;
    this.emit(text);
  }

  /** True once any text from this turn has reached the client (it can no longer be retracted). */
  get hasEmitted(): boolean {
    return this.emitted;
  }

  flush(): void {
    if (!this.discarded && this.buffer) this.send(this.buffer);
    this.buffer = '';
    this.committed = true;
  }

  discard(): void {
    this.discarded = true;
    this.buffer = '';
  }
}

/** Runs one copilot turn: model ⇄ tools for up to MAX_TOOL_ROUNDS, then a streamed, cited answer. */
export async function runChat({ auth, message, history, emit, signal, provider = getChatProvider() }: ChatInput): Promise<void> {
  const [company, user] = await Promise.all([
    prisma.company.findUnique({ where: { id: auth.companyId } }),
    prisma.user.findFirst({ where: { id: auth.userId, companyId: auth.companyId }, select: { name: true } }),
  ]);
  if (!company || !user) throw notFound('Account not found');

  const today = todayIn(company.timezone);
  const citations = new CitationRegistry();
  const ctx: ToolContext = {
    companyId: auth.companyId,
    userId: auth.userId,
    role: auth.role,
    employeeId: auth.employeeId,
    timezone: company.timezone,
    shiftStart: company.shiftStart,
    today,
    citations,
  };
  const system = buildSystemPrompt({
    companyName: company.name,
    userName: user.name,
    role: auth.role,
    hasEmployeeRecord: Boolean(auth.employeeId),
    today,
    timezone: company.timezone,
    shiftStart: company.shiftStart,
  });

  // Prior turns are plain text; drop leading assistant turns so the conversation starts with the user.
  const prior = history.slice(-10);
  while (prior[0]?.role === 'assistant') prior.shift();
  const messages: AgentMessage[] = [...prior.map((m) => ({ role: m.role, content: m.content }) as AgentMessage), { role: 'user', content: message }];
  const tools = toolDefinitions();

  let answer = '';
  let streamed = '';
  const emitText = (text: string) => {
    streamed += text;
    emit({ event: 'token', data: { text } });
  };

  for (let round = 0; ; round++) {
    if (signal?.aborted) return;
    const allowTools = round < MAX_TOOL_ROUNDS;
    const gate = new TextGate(emitText, provider.mayEmitPreamble ? PREAMBLE_HOLD_CHARS : 0);
    const result = await provider.turn({ system, messages, tools, toolChoice: allowTools ? 'auto' : 'none', onText: gate.push, signal });

    if (result.toolCalls.length === 0 || !allowTools || gate.hasEmitted) {
      if (result.toolCalls.length > 0) logger.warn({ round }, 'ignoring tool calls after answer text was already streamed');
      gate.flush();
      answer = result.text;
      if (result.stopNote) emitText(`${answer ? '\n\n' : ''}${result.stopNote}`);
      break;
    }

    gate.discard();
    messages.push({ role: 'assistant', content: result.text, toolCalls: result.toolCalls, providerData: result.providerData });
    for (const [i, call] of result.toolCalls.entries()) {
      const tool = findTool(call.name);
      if (!tool || i >= MAX_CALLS_PER_ROUND) {
        // Every tool call must get a result, or the next request is malformed.
        const error = tool ? 'Too many tool calls in one turn; skipped.' : `Unknown tool "${call.name}".`;
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: JSON.stringify({ error }), isError: true });
        continue;
      }
      emit({ event: 'tool', data: { name: tool.name, label: tool.label } });
      const output = await tool.execute(ctx, call.args);
      logger.debug({ tool: tool.name, ok: output.ok }, 'tool executed');
      messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: JSON.stringify(output.data), isError: !output.ok });
    }
  }

  if (!streamed.trim()) {
    emitText(NO_ANSWER);
    answer = NO_ANSWER;
  }
  emit({ event: 'citations', data: { citations: citations.referencedIn(streamed || answer) } });
  emit({ event: 'done', data: {} });
}
