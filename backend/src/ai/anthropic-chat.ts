/**
 * Claude via @anthropic-ai/sdk — streaming manual tool-use loop (one `turn` = one Messages API call).
 * - Assistant content is replayed verbatim (providerData), so thinking blocks go back unchanged and
 *   the history stays append-only within a request.
 * - Tools stay declared on every round; the last round uses tool_choice "none" instead of removing them.
 * - Tool inputs stream eagerly; they are validated against each tool's Zod schema before running (tools.ts).
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../logger.js';
import type { AgentMessage, ChatProvider, TurnParams, TurnResult } from './types.js';

export function toAnthropicMessages(messages: AgentMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  let results: Anthropic.ToolResultBlockParam[] = [];
  const flushResults = () => {
    // All results for one assistant turn go back in a single user message.
    if (results.length) out.push({ role: 'user', content: results });
    results = [];
  };
  for (const m of messages) {
    if (m.role === 'tool') {
      results.push({ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content, ...(m.isError ? { is_error: true } : {}) });
      continue;
    }
    flushResults();
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.providerData) out.push({ role: 'assistant', content: m.providerData as Anthropic.ContentBlockParam[] });
    else if (m.toolCalls?.length) {
      out.push({
        role: 'assistant',
        content: [
          ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
          ...m.toolCalls.map((c) => ({ type: 'tool_use' as const, id: c.id, name: c.name, input: c.args ?? {} })),
        ],
      });
    } else if (m.content) out.push({ role: 'assistant', content: m.content });
  }
  flushResults();
  return out;
}

export class AnthropicChatProvider implements ChatProvider {
  readonly name = 'anthropic';
  readonly mayEmitPreamble = true;
  // No key in .env → the SDK falls back to its own credential chain (ANTHROPIC_AUTH_TOKEN, `ant auth login` profile).
  constructor(private readonly client: Anthropic = new Anthropic(config.ANTHROPIC_API_KEY ? { apiKey: config.ANTHROPIC_API_KEY } : {})) {}

  async turn({ system, messages, tools, toolChoice, onText, signal }: TurnParams): Promise<TurnResult> {
    const params: Anthropic.MessageStreamParams = {
      model: config.ANTHROPIC_MODEL,
      max_tokens: 64000,
      system,
      messages: toAnthropicMessages(messages),
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
        eager_input_streaming: true,
      })),
      tool_choice: { type: toolChoice },
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
    };

    let message: Anthropic.Message | undefined;
    for (let attempt = 0; !message; attempt++) {
      let streamedText = false;
      const stream = this.client.messages.stream(params, { signal });
      stream.on('text', (delta) => {
        streamedText = true;
        onText(delta);
      });
      try {
        message = await stream.finalMessage();
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError) {
          throw new AppError(500, 'INTERNAL', 'Anthropic rejected the credentials (set ANTHROPIC_API_KEY, or use LLM_PROVIDER=mock).');
        }
        if (err instanceof Anthropic.RateLimitError) throw new AppError(500, 'INTERNAL', 'Claude is rate-limiting requests. Please try again shortly.');
        if (err instanceof Anthropic.APIError || signal?.aborted) throw err;
        // Eager input streaming: a tool input the SDK could not parse rejects finalMessage(). Re-issue once or twice,
        // but only if no text reached the user yet (re-streaming would duplicate it).
        if (attempt >= 2 || streamedText) throw err;
        logger.warn({ err }, 'unparseable tool input from Claude; re-issuing turn');
      }
    }

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

    if (message.stop_reason === 'refusal') {
      return { text, toolCalls: [], stopNote: "I can't help with that request." };
    }
    if (message.stop_reason === 'max_tokens') {
      if (toolUses.length) throw new Error('Claude output was truncated mid tool call (max_tokens)');
      return { text, toolCalls: [], stopNote: '_(The answer was cut off.)_' };
    }
    return {
      text,
      toolCalls: toolUses.map((b) => ({ id: b.id, name: b.name, args: b.input })),
      providerData: message.content,
    };
  }
}
