/** One row of a line-level diff. */
export interface DiffLine {
  type: "same" | "add" | "del";
  text: string;
}

/** Beyond this many DP cells the quadratic LCS table is not worth building;
 *  fall back to "everything changed" (still a correct, if coarse, diff). */
const MAX_LCS_CELLS = 1_000_000;

/**
 * Plain LCS line diff, no dependency: `oldText` → `newText` as a flat list of
 * same/del/add rows. Intended for small documents (agent personas); inputs
 * whose line-count product exceeds the cap degrade to del-all + add-all.
 */
export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const n = a.length;
  const m = b.length;

  if (n * m > MAX_LCS_CELLS) {
    return [
      ...a.map((text) => ({ type: "del" as const, text })),
      ...b.map((text) => ({ type: "add" as const, text })),
    ];
  }

  // dp[i][j] = LCS length of a[i..] vs b[j..].
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: a[i] });
      i++;
    } else {
      out.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: "del", text: a[i++] });
  while (j < m) out.push({ type: "add", text: b[j++] });
  return out;
}
