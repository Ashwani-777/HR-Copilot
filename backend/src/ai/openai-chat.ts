/**
 * Any OpenAI-compatible Chat Completions API (OpenAI, Groq, Ollama, vLLM…) via OPENAI_BASE_URL.
 * Streams text deltas; accumulates streamed tool-call fragments by index.
 */
import OpenAI from 'openai';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';
import type { AgentMessage, ChatProvider, TurnParams, TurnResult } from './types.js';

function parseArgs(raw: string): unknown {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { __invalidJson: raw }; // fails schema validation → error result goes back to the model
  }
}

export function toOpenAIMessages(system: string, messages: AgentMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    else if (m.toolCalls?.length) {
      out.push({
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } })),
      });
    } else if (m.content) out.push({ role: 'assistant', content: m.content });
  }
  return out;
}

export class OpenAIChatProvider implements ChatProvider {
  readonly name = 'openai';
  readonly mayEmitPreamble = true;
  constructor(private readonly client: OpenAI = new OpenAI({ apiKey: config.OPENAI_API_KEY ?? 'not-needed', baseURL: config.OPENAI_BASE_URL })) {}

  async turn({ system, messages, tools, toolChoice, onText, signal }: TurnParams): Promise<TurnResult> {
    let stream;
    try {
      stream = await this.client.chat.completions.create(
        {
          model: config.OPENAI_MODEL,
          messages: toOpenAIMessages(system, messages),
          tools: tools.map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
          tool_choice: toolChoice,
          stream: true,
        },
        { signal },
      );
    } catch (err) {
      if (err instanceof OpenAI.AuthenticationError) throw new AppError(500, 'INTERNAL', 'The OpenAI-compatible API rejected the API key (check OPENAI_API_KEY).');
      if (err instanceof OpenAI.RateLimitError) throw new AppError(500, 'INTERNAL', 'The AI provider is rate-limiting requests. Please try again shortly.');
      if (err instanceof OpenAI.APIConnectionError) throw new AppError(500, 'INTERNAL', 'Could not reach the OpenAI-compatible API (check OPENAI_BASE_URL).');
      throw err;
    }

    let text = '';
    let finish: string | null = null;
    const calls = new Map<number, { id: string; name: string; args: string }>();
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;
      const delta = choice.delta;
      if (delta?.content) {
        text += delta.content;
        onText(delta.content);
      }
      for (const tc of delta?.tool_calls ?? []) {
        const cur = calls.get(tc.index) ?? { id: '', name: '', args: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name && !cur.name) cur.name = tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        calls.set(tc.index, cur);
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }

    if (finish === 'length' && calls.size > 0) throw new Error('Model output was truncated mid tool call (finish_reason=length)');
    const toolCalls = [...calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, c]) => ({ id: c.id || `call_${index}`, name: c.name, args: parseArgs(c.args) }));
    return {
      text,
      toolCalls,
      stopNote: finish === 'length' ? '_(The answer was cut off.)_' : finish === 'content_filter' ? "I can't help with that request." : undefined,
    };
  }
}
