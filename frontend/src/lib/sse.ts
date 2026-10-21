import type { ChatStreamEvent, Citation } from '../types';

/**
 * Minimal Server-Sent Events parser (WHATWG "event stream" interpretation).
 *
 * Why not EventSource? `POST /api/chat` needs a JSON body and an Authorization header,
 * and EventSource can do neither — so we read `fetch()`'s ReadableStream ourselves.
 *
 * Network chunks can split anywhere: mid-field, mid-line, between `\r` and `\n`, or even inside a
 * multi-byte UTF-8 character. The parser therefore buffers text until it sees a full line, and
 * `readSSE` decodes bytes with a streaming TextDecoder.
 */

export type SSEMessage = { event: string; data: string; id?: string };

export class SSEParser {
  private buffer = '';
  private eventType = '';
  private data: string[] = [];
  private lastId: string | undefined;

  constructor(private readonly onMessage: (message: SSEMessage) => void) {}

  /** Feed decoded text. May contain any number of partial or complete events. */
  feed(chunk: string): void {
    this.buffer += chunk;
    let start = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      const ch = this.buffer[i];
      if (ch !== '\n' && ch !== '\r') continue;
      // A trailing "\r" might be the first half of "\r\n" — wait for the next chunk to decide.
      if (ch === '\r' && i === this.buffer.length - 1) break;
      this.processLine(this.buffer.slice(start, i));
      if (ch === '\r' && this.buffer[i + 1] === '\n') i++;
      start = i + 1;
    }
    this.buffer = this.buffer.slice(start);
  }

  /** Call once the stream has ended. Flushes a final event even if the server omitted the blank line. */
  end(): void {
    if (this.buffer.length > 0) {
      const rest = this.buffer.endsWith('\r') ? this.buffer.slice(0, -1) : this.buffer;
      this.buffer = '';
      this.processLine(rest);
    }
    this.dispatch();
  }

  private processLine(line: string): void {
    if (line === '') {
      this.dispatch();
      return;
    }
    if (line.startsWith(':')) return; // comment / keep-alive

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    switch (field) {
      case 'event':
        this.eventType = value;
        break;
      case 'data':
        this.data.push(value);
        break;
      case 'id':
        if (!value.includes('\0')) this.lastId = value;
        break;
      default:
        break; // `retry` and unknown fields are ignored
    }
  }

  private dispatch(): void {
    if (this.data.length === 0) {
      this.eventType = '';
      return;
    }
    const message: SSEMessage = { event: this.eventType || 'message', data: this.data.join('\n') };
    if (this.lastId !== undefined) message.id = this.lastId;
    this.eventType = '';
    this.data = [];
    this.onMessage(message);
  }
}

/** Async-iterate SSE messages from a byte stream (e.g. `response.body`). */
export async function* readSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<SSEMessage> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  const queue: SSEMessage[] = [];
  const parser = new SSEParser((m) => queue.push(m));
  let finished = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        parser.feed(decoder.decode());
        parser.end();
        finished = true;
      } else {
        parser.feed(decoder.decode(value, { stream: true }));
      }
      while (queue.length > 0) yield queue.shift()!;
      if (finished) return;
    }
  } finally {
    if (!finished) {
      // Consumer stopped early (break / abort): cancel the underlying request.
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}

// ---- HR Copilot chat events --------------------------------------------------

function safeJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function isCitation(v: unknown): v is Citation {
  return (
    isObject(v) &&
    typeof v.index === 'number' &&
    typeof v.documentId === 'string' &&
    typeof v.documentTitle === 'string' &&
    (typeof v.page === 'number' || v.page === null) &&
    typeof v.snippet === 'string'
  );
}

/**
 * Map a raw SSE message onto the contract's chat events. Unknown events or malformed payloads
 * return `null` so one bad frame never kills the whole answer.
 */
export function toChatEvent(message: SSEMessage): ChatStreamEvent | null {
  const payload = safeJson(message.data);
  switch (message.event) {
    case 'tool':
      if (isObject(payload) && typeof payload.name === 'string') {
        const label = typeof payload.label === 'string' && payload.label ? payload.label : 'Working…';
        return { type: 'tool', name: payload.name, label };
      }
      return null;
    case 'token':
      return isObject(payload) && typeof payload.text === 'string' ? { type: 'token', text: payload.text } : null;
    case 'citations':
      if (isObject(payload) && Array.isArray(payload.citations)) {
        return { type: 'citations', citations: payload.citations.filter(isCitation) };
      }
      return null;
    case 'done':
      return { type: 'done' };
    case 'error':
      return {
        type: 'error',
        message:
          isObject(payload) && typeof payload.message === 'string' && payload.message
            ? payload.message
            : 'Something went wrong while answering.',
      };
    default:
      return null;
  }
}
