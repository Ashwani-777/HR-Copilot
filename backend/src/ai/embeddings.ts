import OpenAI from 'openai';
import { config } from '../config.js';
import { EMBEDDING_DIMENSIONS, type EmbeddingProvider } from './types.js';
import { fnv1a, terms } from './text.js';

/**
 * Deterministic offline embeddings: signed feature hashing of a bag of (stemmed) words into
 * 1536 dims, log-scaled term frequency, L2-normalised. Not semantic, but cosine similarity
 * behaves like TF cosine, so vector retrieval genuinely works and tests are reproducible.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'mock-bow-1536';
  readonly dimensions = EMBEDDING_DIMENSIONS;
  readonly minSimilarity = 0.06;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }

  embedOne(text: string): number[] {
    const counts = new Map<string, number>();
    for (const term of terms(text)) counts.set(term, (counts.get(term) ?? 0) + 1);
    const vec = new Array<number>(this.dimensions).fill(0);
    for (const [term, tf] of counts) {
      const h = fnv1a(term);
      const index = h % this.dimensions;
      const sign = (fnv1a(`#${term}`) & 1) === 0 ? 1 : -1; // signed hashing: collisions cancel instead of pile up
      vec[index]! += sign * (1 + Math.log(tf));
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    return norm === 0 ? vec : vec.map((v) => v / norm);
  }
}

/** Any OpenAI-compatible /embeddings endpoint. The model must return 1536-dim vectors. */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = EMBEDDING_DIMENSIONS;
  readonly minSimilarity = 0.2;
  readonly id: string;
  private readonly client: OpenAI;

  constructor(private readonly model = config.OPENAI_EMBEDDING_MODEL) {
    this.id = `openai:${model}`;
    this.client = new OpenAI({ apiKey: config.OPENAI_API_KEY ?? 'not-needed', baseURL: config.OPENAI_BASE_URL });
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    // text-embedding-3-* can shorten natively; other models must already be 1536-dim.
    const supportsDimensions = this.model.startsWith('text-embedding-3');
    const res = await this.client.embeddings.create({
      model: this.model,
      input: texts,
      ...(supportsDimensions ? { dimensions: this.dimensions } : {}),
    });
    const vectors = [...res.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    const bad = vectors.find((v) => v.length !== this.dimensions);
    if (bad) {
      throw new Error(`Embedding model "${this.model}" returned ${bad.length} dimensions; Chunk.embedding is vector(${this.dimensions}).`);
    }
    return vectors;
  }
}

let embeddings: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  embeddings ??= config.EMBEDDING_PROVIDER === 'openai' ? new OpenAIEmbeddingProvider() : new MockEmbeddingProvider();
  return embeddings;
}
