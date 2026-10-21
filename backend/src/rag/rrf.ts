export interface FusedResult {
  id: string;
  score: number;
  /** 1-based rank of this id in each input list (null if absent from that list) */
  ranks: (number | null)[];
}

/**
 * Reciprocal Rank Fusion (Cormack et al., 2009): score(d) = Σ_i 1 / (k + rank_i(d)).
 * Rank-based, so it merges lists whose scores live on incompatible scales (ts_rank vs cosine)
 * without any normalisation or weight tuning. k = 60 is the paper's default.
 */
export function reciprocalRankFusion(lists: string[][], k = 60): FusedResult[] {
  const byId = new Map<string, FusedResult>();
  lists.forEach((list, listIndex) => {
    const seen = new Set<string>();
    list.forEach((id, position) => {
      if (seen.has(id)) return; // ignore duplicates within one list
      seen.add(id);
      let entry = byId.get(id);
      if (!entry) {
        entry = { id, score: 0, ranks: lists.map(() => null) };
        byId.set(id, entry);
      }
      const rank = position + 1;
      entry.ranks[listIndex] = rank;
      entry.score += 1 / (k + rank);
    });
  });
  return [...byId.values()].sort((a, b) => b.score - a.score || bestRank(a) - bestRank(b) || a.id.localeCompare(b.id));
}

function bestRank(r: FusedResult): number {
  return Math.min(...r.ranks.map((x) => x ?? Number.POSITIVE_INFINITY));
}
