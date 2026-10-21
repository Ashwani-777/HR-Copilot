/**
 * Real-model providers, verified offline: the official SDKs run against a stubbed fetch that
 * replays canned SSE streams, so request shapes and streaming/tool-call parsing are exercised
 * without API keys or network.
 */
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { AnthropicChatProvider, toAnthropicMessages } from '../../src/ai/anthropic-chat.js';
import { OpenAIChatProvider, toOpenAIMessages } from '../../src/ai/openai-chat.js';
import type { AgentMessage, ToolDefinition } from '../../src/ai/types.js';

const TOOLS: ToolDefinition[] = [
  { name: 'getLateArrivals', description: 'late', inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] } },
];

function sseResponse(events: { event?: string; data: unknown }[]): Response {
  const body = events.map((e) => `${e.event ? `event: ${e.event}\n` : ''}data: ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function stubFetch(responses: Response[]) {
  const requests: any[] = [];
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    return responses.shift()!;
  };
  return { fetch: fetch as unknown as typeof globalThis.fetch, requests };
}

const anthropicEvents = {
  toolUse: [
    { event: 'message_start', data: { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } } },
    { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'getLateArrivals', input: {} } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"from":"2026-10-19",' } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"to":"2026-10-21"}' } } },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
    { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } } },
    { event: 'message_stop', data: { type: 'message_stop' } },
  ],
  text: [
    { event: 'message_start', data: { type: 'message_start', message: { id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 30, output_tokens: 1 } } } },
    { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Rahul was ' } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'late twice.' } } },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
    { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } } },
    { event: 'message_stop', data: { type: 'message_stop' } },
  ],
};

describe('Anthropic provider', () => {
  it('sends the expected request and parses a streamed tool_use', async () => {
    const { fetch, requests } = stubFetch([sseResponse(anthropicEvents.toolUse)]);
    const provider = new AnthropicChatProvider(new Anthropic({ apiKey: 'test-key', fetch, maxRetries: 0 }));
    const result = await provider.turn({ system: 'SYS', messages: [{ role: 'user', content: 'who was late?' }], tools: TOOLS, toolChoice: 'auto', onText: () => {} });

    expect(result.toolCalls).toEqual([{ id: 'toolu_1', name: 'getLateArrivals', args: { from: '2026-10-19', to: '2026-10-21' } }]);
    const req = requests[0];
    expect(req).toMatchObject({ model: 'claude-haiku-5-5', system: 'SYS', stream: true, tool_choice: { type: 'auto' }, output_config: { effort: 'medium' } });
    expect(req.tools[0]).toMatchObject({ name: 'getLateArrivals', eager_input_streaming: true, input_schema: TOOLS[0]!.inputSchema });
    expect(req).not.toHaveProperty('temperature');
  });

  it('streams text deltas and replays assistant content + grouped tool results on the next round', async () => {
    const { fetch, requests } = stubFetch([sseResponse(anthropicEvents.toolUse), sseResponse(anthropicEvents.text)]);
    const provider = new AnthropicChatProvider(new Anthropic({ apiKey: 'test-key', fetch, maxRetries: 0 }));
    const messages: AgentMessage[] = [{ role: 'user', content: 'who was late?' }];
    const first = await provider.turn({ system: 'SYS', messages, tools: TOOLS, toolChoice: 'auto', onText: () => {} });
    messages.push({ role: 'assistant', content: first.text, toolCalls: first.toolCalls, providerData: first.providerData });
    messages.push({ role: 'tool', toolCallId: 'toolu_1', name: 'getLateArrivals', content: '{"employees":[]}' });

    const deltas: string[] = [];
    const second = await provider.turn({ system: 'SYS', messages, tools: TOOLS, toolChoice: 'none', onText: (d) => deltas.push(d) });
    expect(deltas).toEqual(['Rahul was ', 'late twice.']);
    expect(second).toMatchObject({ text: 'Rahul was late twice.', toolCalls: [] });
    expect(requests[1].tool_choice).toEqual({ type: 'none' });
    expect(requests[1].tools).toHaveLength(1); // tools stay declared on the final round
    expect(requests[1].messages[1]).toEqual({ role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'getLateArrivals', input: { from: '2026-10-19', to: '2026-10-21' } }] });
    expect(requests[1].messages[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"employees":[]}' }] });
  });

  it('puts all tool results for one turn into a single user message', () => {
    const mapped = toAnthropicMessages([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'x', args: {} }, { id: 'b', name: 'y', args: {} }] },
      { role: 'tool', toolCallId: 'a', name: 'x', content: '1' },
      { role: 'tool', toolCallId: 'b', name: 'y', content: '2', isError: true },
    ]);
    expect(mapped).toHaveLength(3);
    expect(mapped[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'a', content: '1' },
        { type: 'tool_result', tool_use_id: 'b', content: '2', is_error: true },
      ],
    });
  });
});

describe('OpenAI-compatible provider', () => {
  const chunk = (delta: object, finish: string | null = null) => ({
    id: 'c1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'gpt-test',
    choices: [{ index: 0, delta, finish_reason: finish }],
  });

  it('accumulates streamed tool-call fragments by index', async () => {
    const { fetch, requests } = stubFetch([
      sseResponse([
        { data: chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'getLateArrivals', arguments: '' } }] }) },
        { data: chunk({ tool_calls: [{ index: 0, function: { arguments: '{"from":"2026-10-19",' } }] }) },
        { data: chunk({ tool_calls: [{ index: 0, function: { arguments: '"to":"2026-10-21"}' } }] }) },
        { data: chunk({}, 'tool_calls') },
        { data: '[DONE]' },
      ]),
    ]);
    const provider = new OpenAIChatProvider(new OpenAI({ apiKey: 'test-key', fetch, maxRetries: 0 }));
    const result = await provider.turn({ system: 'SYS', messages: [{ role: 'user', content: 'late?' }], tools: TOOLS, toolChoice: 'auto', onText: () => {} });
    expect(result.toolCalls).toEqual([{ id: 'call_1', name: 'getLateArrivals', args: { from: '2026-10-19', to: '2026-10-21' } }]);
    expect(requests[0]).toMatchObject({ stream: true, tool_choice: 'auto', messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'late?' }] });
    expect(requests[0].tools[0]).toEqual({ type: 'function', function: { name: 'getLateArrivals', description: 'late', parameters: TOOLS[0]!.inputSchema } });
  });

  it('streams text and maps tool history to assistant.tool_calls + role:tool', async () => {
    const { fetch } = stubFetch([sseResponse([{ data: chunk({ content: 'Nobody ' }) }, { data: chunk({ content: 'was late.' }, 'stop') }, { data: '[DONE]' }])]);
    const provider = new OpenAIChatProvider(new OpenAI({ apiKey: 'test-key', fetch, maxRetries: 0 }));
    const deltas: string[] = [];
    const result = await provider.turn({ system: 'S', messages: [{ role: 'user', content: 'q' }], tools: TOOLS, toolChoice: 'none', onText: (d) => deltas.push(d) });
    expect(deltas.join('')).toBe('Nobody was late.');
    expect(result.toolCalls).toEqual([]);

    const mapped = toOpenAIMessages('S', [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'getLateArrivals', args: { from: 'a' } }] },
      { role: 'tool', toolCallId: 'call_1', name: 'getLateArrivals', content: '{}' },
    ]);
    expect(mapped[2]).toEqual({ role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'getLateArrivals', arguments: '{"from":"a"}' } }] });
    expect(mapped[3]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '{}' });
  });
});
