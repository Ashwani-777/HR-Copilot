import { prisma } from '../db.js';
import { getEmbeddingProvider } from '../ai/embeddings.js';
import { reciprocalRankFusion } from './rrf.js';

export interface RetrievedChunk {
  id: string;
  documentId: string;
  documentTitle: string;
  page: number | null;
  content: string;
  score: number;
  /** rank in [fullText, vector] lists (1-based, null = not retrieved by that method) */
  ranks?: (number | null)[];
}

const CANDIDATES = 20;

/**
 * Natural-language questions make poor AND-queries ("how many casual leaves do I get" would require
 * every word), so we OR the words together and let ts_rank prefer chunks matching more of them.
 * Still parsed by websearch_to_tsquery, which handles stemming/stopwords and never throws on input.
 */
export function toOrQuery(query: string): string {
  const tokens = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(tokens.filter((t) => t !== 'or' && t !== 'and' && t.length > 1))].join(' or ');
}

type Row = { id: string; documentId: string; documentTitle: string; page: number | null; content: string; score: number };

export async function fullTextSearch(companyId: string, query: string, limit = CANDIDATES): Promise<RetrievedChunk[]> {
  const q = toOrQuery(query);
  if (!q) return [];
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT c.id, c."documentId", d.title AS "documentTitle", c.page, c.content,
           ts_rank(c.tsv, query, 1)::float8 AS score
    FROM "Chunk" c
    JOIN "Document" d ON d.id = c."documentId"
    CROSS JOIN websearch_to_tsquery('english', ${q}) AS query
    WHERE c."companyId" = ${companyId}
      AND d."companyId" = ${companyId}
      AND d.status = 'READY'
      AND c.tsv @@ query
    ORDER BY score DESC, c."chunkIndex" ASC
    LIMIT ${limit}`;
  return rows;
}

export async function vectorSearch(companyId: string, query: string, limit = CANDIDATES): Promise<RetrievedChunk[]> {
  const embedder = getEmbeddingProvider();
  const [embedding] = await embedder.embed([query]);
  if (!embedding || embedding.every((v) => v === 0)) return [];
  const vector = `[${embedding.join(',')}]`;
  // pgvector >= 0.8: keep scanning the HNSW index until enough rows survive the tenant filter.
  const [, rows] = await prisma.$transaction([
    prisma.$executeRawUnsafe(`SET LOCAL hnsw.iterative_scan = 'relaxed_order'`),
    prisma.$queryRaw<Row[]>`
      SELECT c.id, c."documentId", d.title AS "documentTitle", c.page, c.content,
             (1 - (c.embedding <=> ${vector}::vector))::float8 AS score
      FROM "Chunk" c
      JOIN "Document" d ON d.id = c."documentId"
      WHERE c."companyId" = ${companyId}
        AND d."companyId" = ${companyId}
        AND d.status = 'READY'
        AND d."embeddingModel" = ${embedder.id}
        AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> ${vector}::vector
      LIMIT ${limit}`,
  ]);
  return rows.filter((r) => r.score >= embedder.minSimilarity);
}

/** Hybrid retrieval: full-text + vector candidates merged with Reciprocal Rank Fusion. Always tenant-scoped. */
export async function hybridSearch(companyId: string, query: string, k = 5): Promise<RetrievedChunk[]> {
  const [fts, vec] = await Promise.all([fullTextSearch(companyId, query), vectorSearch(companyId, query)]);
  const byId = new Map<string, RetrievedChunk>();
  for (const r of [...fts, ...vec]) if (!byId.has(r.id)) byId.set(r.id, r);
  return reciprocalRankFusion([fts.map((r) => r.id), vec.map((r) => r.id)])
    .slice(0, k)
    .map((f) => ({ ...byId.get(f.id)!, score: f.score, ranks: f.ranks }));
}
