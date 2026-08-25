export type DiffRow = { type: "eq" | "add" | "del"; text: string };

/**
 * Cheap line diff for the inline Changes preview. Not a full Myers; good
 * enough to show what changed without pulling a dependency.
 */
export function diffLines(head: string, working: string): DiffRow[] {
  const a = head.split("\n");
  const b = working.split("\n");
  const out: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: "eq", text: a[i] });
      i += 1;
      j += 1;
      continue;
    }
    const inB = b.indexOf(a[i], j);
    const inA = a.indexOf(b[j], i);
    const bHit = inB !== -1 ? inB - j : Infinity;
    const aHit = inA !== -1 ? inA - i : Infinity;
    if (aHit <= bHit && aHit < 40) {
      while (i < inA) {
        out.push({ type: "del", text: a[i] });
        i += 1;
      }
    } else if (bHit < 40) {
      while (j < inB) {
        out.push({ type: "add", text: b[j] });
        j += 1;
      }
    } else {
      out.push({ type: "del", text: a[i] });
      out.push({ type: "add", text: b[j] });
      i += 1;
      j += 1;
    }
  }
  while (i < a.length) {
    out.push({ type: "del", text: a[i] });
    i += 1;
  }
  while (j < b.length) {
    out.push({ type: "add", text: b[j] });
    j += 1;
  }
  return out;
}

/** Keep context around edits so a 400-line file doesn't dump every equal line. */
export function collapseUnchanged(rows: DiffRow[], context = 2): DiffRow[] {
  const keep = new Set<number>();
  rows.forEach((row, idx) => {
    if (row.type === "eq") return;
    for (let k = Math.max(0, idx - context); k <= Math.min(rows.length - 1, idx + context); k++) {
      keep.add(k);
    }
  });
  if (keep.size === 0) return rows.slice(0, Math.min(rows.length, 8));
  const out: DiffRow[] = [];
  for (let idx = 0; idx < rows.length; idx++) {
    if (keep.has(idx)) out.push(rows[idx]);
  }
  return out;
}
