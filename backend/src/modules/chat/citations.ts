import type { RetrievedChunk } from '../../rag/search.js';

export interface Citation {
  /** 1-based, matches [n] in the answer text */
  index: number;
  documentId: string;
  documentTitle: string;
  page: number | null;
  snippet: string;
}

const SNIPPET_CHARS = 320;

function toSnippet(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  const lead = /^[a-z]/.test(flat) ? '…' : ''; // chunk starts mid-sentence
  return lead + (flat.length <= SNIPPET_CHARS ? flat : `${flat.slice(0, SNIPPET_CHARS).replace(/\s+\S*$/, '')}…`);
}

/** Numbers retrieved chunks across all searchPolicy calls in one chat turn (deduplicated by chunk). */
export class CitationRegistry {
  private readonly byChunk = new Map<string, Citation>();

  register(chunk: RetrievedChunk): number {
    const existing = this.byChunk.get(chunk.id);
    if (existing) return existing.index;
    const citation: Citation = {
      index: this.byChunk.size + 1,
      documentId: chunk.documentId,
      documentTitle: chunk.documentTitle,
      page: chunk.page,
      snippet: toSnippet(chunk.content),
    };
    this.byChunk.set(chunk.id, citation);
    return citation.index;
  }

  get size(): number {
    return this.byChunk.size;
  }

  /** Only the citations the answer actually references, in index order. */
  referencedIn(text: string): Citation[] {
    const used = new Set<number>();
    for (const m of text.matchAll(/\[(\d{1,3})\]/g)) used.add(Number(m[1]));
    return [...this.byChunk.values()].filter((c) => used.has(c.index)).sort((a, b) => a.index - b.index);
  }
}
