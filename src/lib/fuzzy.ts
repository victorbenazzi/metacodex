/**
 * Lightweight subsequence fuzzy matcher. Returns a score (higher is better) or
 * -1 when `query` isn't a subsequence of `target`. Rewards consecutive matches
 * and matches right after a path/word boundary, so "exst" ranks
 * "explorer.store.ts" well. No dependency, good enough for palette ranking.
 */
export function fuzzyScore(query: string, target: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const found = t.indexOf(q[qi], ti);
    if (found === -1) return -1;
    let s = 1;
    if (found === prev + 1) s += 5; // consecutive run
    if (found === 0 || /[/\-_. ]/.test(t[found - 1])) s += 3; // boundary
    score += s;
    prev = found;
    ti = found + 1;
  }
  // Bias slightly toward shorter targets (denser match).
  return score - Math.floor(t.length / 40);
}
