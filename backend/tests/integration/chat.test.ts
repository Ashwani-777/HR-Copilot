import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { runChat, MAX_TOOL_ROUNDS, type ChatEvent } from '../../src/modules/chat/agent.js';
import type { ChatProvider, TurnParams, TurnResult } from '../../src/ai/types.js';
import { ACME_ADMIN, answerText, app, bearer, login, parseSse, RIYA, type Session } from '../helpers/http.js';

describe('POST /api/chat (SSE)', () => {
  let admin: Session;
  let riya: Session;
  beforeAll(async () => {
    [admin, riya] = await Promise.all([login(ACME_ADMIN), login(RIYA)]);
  });

  const ask = async (s: Session, message: string, history?: unknown[]) => {
    const res = await request(app).post('/api/chat').set(bearer(s)).send({ message, history });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    return parseSse(res.text);
  };

  const order = (events: { event: string }[]) => events.map((e) => e.event).filter((e, i, a) => e !== a[i - 1]);

  it('answers policy questions with [n] citations, events in contract order', async () => {
    const events = await ask(riya, 'How many casual leaves do I get?');
    expect(order(events)).toEqual(['tool', 'token', 'citations', 'done']);
    expect(events[0]!.data).toEqual({ name: 'searchPolicy', label: expect.any(String) });
    const text = answerText(events);
    expect(text).toMatch(/12 days of Casual Leave/);
    expect(text).toMatch(/\[1\]/);
    const citations = events.find((e) => e.event === 'citations')!.data.citations;
    expect(citations[0]).toEqual({ index: 1, documentId: expect.any(String), documentTitle: 'Acme HR Policy', page: expect.any(Number), snippet: expect.any(String) });
    for (const c of citations) expect(text).toContain(`[${c.index}]`);
  });

  it('calls a data tool for "Who was late this week?"', async () => {
    const events = await ask(admin, 'Who was late this week?');
    expect(events[0]).toEqual({ event: 'tool', data: { name: 'getLateArrivals', label: 'Checking late arrivals…' } });
    expect(answerText(events)).toMatch(/late check-in|Nobody checked in late/);
    expect(events.at(-1)!.event).toBe('done');
  });

  it('answers "Who is on leave today?" from leave data', async () => {
    const events = await ask(admin, 'Who is on leave today?');
    expect(events[0]!.data.name).toBe('getWhoIsOnLeave');
    expect(answerText(events)).toContain('Neha Kapoor');
  });

  it("says it doesn't know when nothing relevant is found", async () => {
    const events = await ask(admin, 'What is the capital of France?');
    expect(answerText(events)).toMatch(/I don't know/);
    expect(events.find((e) => e.event === 'citations')!.data.citations).toEqual([]);
  });

  it('accepts history and validates input before streaming', async () => {
    const events = await ask(riya, "What's the work-from-home policy?", [
      { role: 'assistant', content: 'Hi! Ask me anything.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hello Riya!' },
    ]);
    expect(answerText(events)).toMatch(/work from home/i);
    const bad = await request(app).post('/api/chat').set(bearer(riya)).send({ message: '' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect((await request(app).post('/api/chat').send({ message: 'hi' })).status).toBe(401);
  });
});

describe('agent loop', () => {
  let admin: Session;
  beforeAll(async () => {
    admin = await login(ACME_ADMIN);
  });

  const auth = () => ({ userId: admin.user.id, companyId: admin.user.companyId, role: 'ADMIN' as const, employeeId: admin.user.employeeId });

  it(`stops after ${MAX_TOOL_ROUNDS} tool rounds and forces a final answer`, async () => {
    const calls: TurnParams['toolChoice'][] = [];
    const greedy: ChatProvider = {
      name: 'greedy',
      mayEmitPreamble: true,
      async turn(p: TurnParams): Promise<TurnResult> {
        calls.push(p.toolChoice);
        if (p.toolChoice === 'none') {
          p.onText('Final answer.');
          return { text: 'Final answer.', toolCalls: [] };
        }
        p.onText('Let me check that for you… '); // preamble: must never reach the client
        return { text: 'Let me check that for you… ', toolCalls: [{ id: `c${calls.length}`, name: 'searchPolicy', args: { query: 'leave' } }] };
      },
    };
    const events: ChatEvent[] = [];
    await runChat({ auth: auth(), message: 'loop forever', history: [], emit: (e) => events.push(e), provider: greedy });
    expect(calls).toEqual(['auto', 'auto', 'auto', 'auto', 'none']);
    expect(events.filter((e) => e.event === 'tool')).toHaveLength(MAX_TOOL_ROUNDS);
    const text = events.filter((e) => e.event === 'token').map((e) => (e.data as { text: string }).text).join('');
    expect(text).toBe('Final answer.');
    expect(events.at(-1)!.event).toBe('done');
  });

  it('returns invalid tool arguments to the model as an error instead of crashing', async () => {
    let seenError = '';
    const sloppy: ChatProvider = {
      name: 'sloppy',
      mayEmitPreamble: false,
      async turn(p: TurnParams): Promise<TurnResult> {
        const last = p.messages.at(-1)!;
        if (last.role === 'tool') {
          seenError = last.content;
          p.onText('Sorry, I could not run that.');
          return { text: 'Sorry, I could not run that.', toolCalls: [] };
        }
        return { text: '', toolCalls: [{ id: 'x', name: 'getLateArrivals', args: { from: 'last tuesday', to: 42 } }] };
      },
    };
    await runChat({ auth: auth(), message: 'late?', history: [], emit: () => {}, provider: sloppy });
    expect(JSON.parse(seenError)).toMatchObject({ error: 'Invalid arguments' });
  });
});
