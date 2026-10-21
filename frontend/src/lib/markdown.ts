/**
 * Deliberately tiny Markdown subset for copilot answers — no HTML is ever injected.
 * Blocks: paragraphs, headings, bullet/numbered lists, fenced code, simple pipe tables.
 * Inline: **bold**, *italic*, `code`, [text](https://…) links and [n] citation markers.
 * Tolerant of half-streamed input (an unclosed ** just renders as text until it closes).
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] }
  | { type: 'cite'; indices: number[] };

export type Block =
  | { type: 'p'; lines: string[] }
  | { type: 'h'; level: number; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; start: number; items: string[] }
  | { type: 'code'; text: string }
  | { type: 'table'; header: string[]; rows: string[][] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const ORDERED = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^\s*```/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === '') {
      i++;
      continue;
    }

    if (FENCE.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i]!)) body.push(lines[i++]!);
      i++; // closing fence (or end of input while streaming)
      blocks.push({ type: 'code', text: body.join('\n') });
      continue;
    }

    const h = HEADING.exec(line);
    if (h) {
      blocks.push({ type: 'h', level: h[1]!.length, text: h[2]!.trim() });
      i++;
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!)) {
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim() !== '') rows.push(splitRow(lines[i++]!));
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet || ordered) {
      const isOrdered = !bullet;
      const re = isOrdered ? ORDERED : BULLET;
      const items: string[] = [];
      const start = ordered ? Number(ordered[1]) : 1;
      while (i < lines.length) {
        const cur = lines[i]!;
        const m = re.exec(cur);
        if (m) {
          items.push((isOrdered ? m[2] : m[1])!.trim());
          i++;
        } else if (cur.trim() !== '' && /^\s{2,}/.test(cur) && items.length > 0) {
          items[items.length - 1] += ` ${cur.trim()}`; // continuation line
          i++;
        } else break;
      }
      blocks.push(isOrdered ? { type: 'ol', start, items } : { type: 'ul', items });
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !FENCE.test(lines[i]!) &&
      !HEADING.test(lines[i]!) &&
      !BULLET.test(lines[i]!) &&
      !ORDERED.test(lines[i]!)
    ) {
      para.push(lines[i++]!.trim());
    }
    if (para.length === 0) {
      // Defensive: never loop forever on an unexpected line shape.
      para.push(line.trim());
      i++;
    }
    blocks.push({ type: 'p', lines: para });
  }
  return blocks;
}

const INLINE =
  /(\*\*|__)(.+?)\1|`([^`]+)`|\[(\d+(?:\s*,\s*\d+)*)\](?!\()|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*([^*\s][^*]*?)\*/g;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const re = new RegExp(INLINE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) out.push({ type: 'text', text: src.slice(last, m.index) });
    if (m[2] !== undefined) out.push({ type: 'strong', children: parseInline(m[2]) });
    else if (m[3] !== undefined) out.push({ type: 'code', text: m[3] });
    else if (m[4] !== undefined) {
      // "start [1]." → "start¹." — the marker hugs the preceding word.
      const prev = out[out.length - 1];
      if (prev?.type === 'text') {
        prev.text = prev.text.replace(/\s+$/, '');
        if (prev.text === '') out.pop();
      }
      out.push({ type: 'cite', indices: m[4].split(',').map((n) => Number(n.trim())) });
    }
    else if (m[5] !== undefined && m[6] !== undefined)
      out.push({ type: 'link', href: m[6], children: parseInline(m[5]) });
    else if (m[7] !== undefined) out.push({ type: 'em', children: parseInline(m[7]) });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ type: 'text', text: src.slice(last) });
  return out;
}

/**
 * While tokens are still arriving, hide a dangling `**` / `` ` `` so half-finished formatting never
 * flashes as raw syntax ("You get **12" → "You get 12").
 */
export function tidyStreaming(src: string): string {
  let out = src;
  if ((out.match(/\*\*/g)?.length ?? 0) % 2 === 1) {
    const i = out.lastIndexOf('**');
    out = out.slice(0, i) + out.slice(i + 2);
  }
  if ((out.match(/`/g)?.length ?? 0) % 2 === 1) {
    const i = out.lastIndexOf('`');
    out = out.slice(0, i) + out.slice(i + 1);
  }
  return out;
}

/** DOM id of a source pill, so a [n] marker can link to it. */
export const citePillId = (idPrefix: string, index: number) => `${idPrefix}-cite-${index}`;
