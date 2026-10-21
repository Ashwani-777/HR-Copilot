import { describe, expect, it } from 'vitest';
import { readSSE, SSEParser, toChatEvent, type SSEMessage } from './sse';

/** A realistic /api/chat response body, exactly as the contract describes it. */
const CHAT_STREAM = [
  'event: tool\ndata: {"name":"getLateArrivals","label":"Checking late arrivals…"}\n\n',
  'event: token\ndata: {"text":"Three people "}\n\n',
  'event: token\ndata: {"text":"were late [1]."}\n\n',
  'event: citations\ndata: {"citations":[{"index":1,"documentId":"d1","documentTitle":"Acme HR Policy","page":2,"snippet":"Grace period 10 min"}]}\n\n',
  'event: done\ndata: {}\n\n',
].join('');

function parseAll(chunks: string[]): SSEMessage[] {
  const out: SSEMessage[] = [];
  const parser = new SSEParser((m) => out.push(m));
  for (const c of chunks) parser.feed(c);
  parser.end();
  return out;
}

/** Split a string into fixed-size pieces (size 1 = every possible split point). */
function splitEvery(s: string, size: number): string[] {
  const parts: string[] = [];
  for (let i = 0; i < s.length; i += size) parts.push(s.slice(i, i + size));
  return parts;
}

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<SSEMessage[]> {
  const out: SSEMessage[] = [];
  for await (const m of readSSE(stream)) out.push(m);
  return out;
}

const expected = parseAll([CHAT_STREAM]);

describe('SSEParser', () => {
  it('parses a whole chat stream delivered in one chunk', () => {
    expect(expected.map((m) => m.event)).toEqual(['tool', 'token', 'token', 'citations', 'done']);
    expect(JSON.parse(expected[1]!.data)).toEqual({ text: 'Three people ' });
  });

  it('gives identical results no matter where chunks are split (every split point)', () => {
    for (const size of [1, 2, 3, 5, 7, 13, 64]) {
      expect(parseAll(splitEvery(CHAT_STREAM, size))).toEqual(expected);
    }
  });

  it('handles a chunk boundary inside "event:" and inside the JSON payload', () => {
    const msgs = parseAll(['eve', 'nt: tok', 'en\ndata: {"te', 'xt":"hel', 'lo"}', '\n', '\n']);
    expect(msgs).toEqual([{ event: 'token', data: '{"text":"hello"}' }]);
  });

  it('supports CRLF and lone CR line endings, including CRLF split across chunks', () => {
    const msgs = parseAll(['event: token\r', '\ndata: {"text":"a"}\r\n\r', '\nevent: done\rdata: {}\r\r']);
    expect(msgs).toEqual([
      { event: 'token', data: '{"text":"a"}' },
      { event: 'done', data: '{}' },
    ]);
  });

  it('joins multi-line data with \\n and ignores comments / keep-alives / unknown fields', () => {
    const msgs = parseAll([': keep-alive\n\nretry: 3000\nfoo: bar\ndata: line one\ndata: line two\n\n']);
    expect(msgs).toEqual([{ event: 'message', data: 'line one\nline two' }]);
  });

  it('strips exactly one leading space after the colon', () => {
    expect(parseAll(['data:no-space\n\n', 'data:  two-spaces\n\n'])).toEqual([
      { event: 'message', data: 'no-space' },
      { event: 'message', data: ' two-spaces' },
    ]);
  });

  it('does not dispatch an event that has no data', () => {
    expect(parseAll(['event: tool\n\n'])).toEqual([]);
  });

  it('flushes a final event when the server omits the trailing blank line', () => {
    expect(parseAll(['event: done\ndata: {}'])).toEqual([{ event: 'done', data: '{}' }]);
  });

  it('remembers the last event id', () => {
    expect(parseAll(['id: 7\ndata: x\n\n'])).toEqual([{ event: 'message', data: 'x', id: '7' }]);
  });
});

describe('readSSE (bytes → messages)', () => {
  it('parses byte chunks split at every position, including inside multi-byte UTF-8 ("…", "₹")', async () => {
    const text = CHAT_STREAM + 'event: token\ndata: {"text":"₹500 allowance"}\n\n';
    const bytes = new TextEncoder().encode(text);
    const want = parseAll([text]);
    for (const size of [1, 2, 3, 4, 9, 100]) {
      const chunks: Uint8Array[] = [];
      for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.slice(i, i + size));
      expect(await collect(streamOf(chunks))).toEqual(want);
    }
    expect(JSON.parse(want.at(-1)!.data)).toEqual({ text: '₹500 allowance' });
  });

  it('cancels the underlying stream when the consumer stops early', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: 1\n\ndata: 2\n\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const m of readSSE(stream)) {
      expect(m.data).toBe('1');
      break;
    }
    expect(cancelled).toBe(true);
  });
});

describe('toChatEvent', () => {
  it('maps every contract event', () => {
    expect(expected.map(toChatEvent)).toEqual([
      { type: 'tool', name: 'getLateArrivals', label: 'Checking late arrivals…' },
      { type: 'token', text: 'Three people ' },
      { type: 'token', text: 'were late [1].' },
      {
        type: 'citations',
        citations: [{ index: 1, documentId: 'd1', documentTitle: 'Acme HR Policy', page: 2, snippet: 'Grace period 10 min' }],
      },
      { type: 'done' },
    ]);
  });

  it('maps error events and falls back to a generic message', () => {
    expect(toChatEvent({ event: 'error', data: '{"message":"LLM timeout"}' })).toEqual({
      type: 'error',
      message: 'LLM timeout',
    });
    expect(toChatEvent({ event: 'error', data: 'not json' })).toMatchObject({ type: 'error' });
  });

  it('returns null for malformed payloads and unknown events instead of throwing', () => {
    expect(toChatEvent({ event: 'token', data: '{"text":' })).toBeNull();
    expect(toChatEvent({ event: 'ping', data: '{}' })).toBeNull();
  });

  it('drops malformed citation entries but keeps valid ones', () => {
    const ev = toChatEvent({
      event: 'citations',
      data: JSON.stringify({
        citations: [
          { index: 1, documentId: 'd', documentTitle: 'T', page: null, snippet: 's' },
          { index: 'x' },
        ],
      }),
    });
    expect(ev).toEqual({
      type: 'citations',
      citations: [{ index: 1, documentId: 'd', documentTitle: 'T', page: null, snippet: 's' }],
    });
  });
});
