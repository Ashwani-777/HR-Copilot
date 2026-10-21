export interface PageText {
  /** 1-based page number */
  page: number;
  text: string;
}

export interface TextChunk {
  page: number;
  chunkIndex: number;
  content: string;
}

export interface ChunkOptions {
  size?: number;
  overlap?: number;
}

export const DEFAULT_CHUNK_SIZE = 800;
export const DEFAULT_CHUNK_OVERLAP = 150;
const MIN_OVERLAP = 40;

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Last occurrence of any separator inside window[minPos..], returning the index just after it. */
function lastBreak(window: string, separators: string[], minPos: number): number | null {
  let best = -1;
  for (const sep of separators) {
    const idx = window.lastIndexOf(sep);
    if (idx >= minPos && idx + sep.length > best) best = idx + sep.length;
  }
  return best > 0 ? best : null;
}

/**
 * Split text into ~`size`-char chunks with `overlap` chars of shared context between neighbours.
 * Prefers to break at paragraph, then sentence/line, then word boundaries (never mid-word unless a
 * single "word" is longer than the window).
 */
export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const size = opts.size ?? DEFAULT_CHUNK_SIZE;
  const overlap = Math.min(opts.overlap ?? DEFAULT_CHUNK_OVERLAP, Math.floor(size / 3));
  const clean = normalizeText(text);
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  const chunks: string[] = [];
  const minBreak = Math.floor(size * 0.5);
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const bp =
        lastBreak(window, ['\n\n'], minBreak) ??
        lastBreak(window, ['. ', '.\n', '? ', '! ', ':\n', '\n'], minBreak) ??
        lastBreak(window, [' ', '\t'], minBreak);
      if (bp !== null) end = start + bp;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;

    // Step back `overlap` chars, then forward to the next sentence start (keeping ≥ MIN_OVERLAP chars of
    // shared context), else to the next word start — so chunks and citation snippets don't begin mid-word.
    let next = Math.max(end - overlap, start + 1);
    const tail = clean.slice(next, end);
    const sentenceStart = tail.search(/(?<=[.!?:])\s|\n/);
    if (sentenceStart >= 0 && tail.length - (sentenceStart + 1) >= MIN_OVERLAP) next += sentenceStart + 1;
    else {
      const ws = tail.search(/\s/);
      if (ws >= 0) next += ws + 1;
    }
    while (next < end && /\s/.test(clean[next]!)) next++;
    start = next >= end ? end : next;
  }
  return chunks;
}

/** Chunk each page separately so every chunk keeps an exact page number for citations. */
export function chunkPages(pages: PageText[], opts: ChunkOptions = {}): TextChunk[] {
  const out: TextChunk[] = [];
  for (const { page, text } of pages) {
    for (const content of chunkText(text, opts)) out.push({ page, chunkIndex: out.length, content });
  }
  return out;
}

/**
 * Plain-text / Markdown files have no pages, so split them into ~`target`-char "pages" at paragraph
 * boundaries (page 1..n). Citations then read "p. 2" just like for PDFs.
 */
export function splitIntoPseudoPages(text: string, target = 3000): PageText[] {
  const clean = normalizeText(text);
  if (!clean) return [];
  const paragraphs = clean.split(/\n\n/);
  const pages: string[] = [];
  let current = '';
  for (const para of paragraphs) {
    if (current && current.length + para.length + 2 > target) {
      pages.push(current);
      current = '';
    }
    // A single enormous paragraph is hard-split so no page balloons.
    if (para.length > target * 2) {
      for (let i = 0; i < para.length; i += target) pages.push(para.slice(i, i + target));
      continue;
    }
    current = current ? `${current}\n\n${para}` : para;
  }
  if (current) pages.push(current);
  return pages.map((t, i) => ({ page: i + 1, text: t }));
}
