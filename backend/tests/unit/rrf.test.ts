import { describe, expect, it } from 'vitest';
import { reciprocalRankFusion } from '../../src/rag/rrf.js';

describe('Reciprocal Rank Fusion', () => {
  it('ranks a document found by both retrievers above single-list documents', () => {
    const fused = reciprocalRankFusion([
      ['a', 'b', 'c'], // full-text
      ['d', 'b', 'e'], // vector
    ]);
    expect(fused[0]!.id).toBe('b');
    expect(fused[0]!.score).toBeCloseTo(1 / 62 + 1 / 62, 10);
    expect(fused[0]!.ranks).toEqual([2, 2]);
  });

  it('computes Σ 1/(k + rank) with k = 60 by default', () => {
    const fused = reciprocalRankFusion([['x', 'y'], ['y']]);
    const y = fused.find((f) => f.id === 'y')!;
    const x = fused.find((f) => f.id === 'x')!;
    expect(y.score).toBeCloseTo(1 / 62 + 1 / 61, 10);
    expect(x.score).toBeCloseTo(1 / 61, 10);
    expect(x.ranks).toEqual([1, null]);
    expect(fused.map((f) => f.id)).toEqual(['y', 'x']);
  });

  it('respects a custom k', () => {
    const [top] = reciprocalRankFusion([['a']], 10);
    expect(top!.score).toBeCloseTo(1 / 11, 10);
  });

  it('handles empty lists and one-sided results', () => {
    expect(reciprocalRankFusion([[], []])).toEqual([]);
    expect(reciprocalRankFusion([[], ['p', 'q']]).map((f) => f.id)).toEqual(['p', 'q']);
  });

  it('ignores duplicates within a list and breaks ties deterministically', () => {
    const fused = reciprocalRankFusion([['a', 'a', 'b'], ['b', 'a']]);
    // a: 1/61 + 1/62, b: 1/62 + 1/61 (duplicate 'a' at position 2 is ignored, so b is rank 3 in list 1)
    const a = fused.find((f) => f.id === 'a')!;
    const b = fused.find((f) => f.id === 'b')!;
    expect(a.score).toBeCloseTo(1 / 61 + 1 / 62, 10);
    expect(b.score).toBeCloseTo(1 / 63 + 1 / 61, 10);
    expect(fused[0]!.id).toBe('a');
  });
});
