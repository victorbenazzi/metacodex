import {
  StateField,
  StateEffect,
  RangeSet,
  RangeSetBuilder,
  type Extension,
  type Text,
} from "@codemirror/state";
import { gutter, GutterMarker } from "@codemirror/view";
import { diff } from "@codemirror/merge";

/**
 * Passive, read-only change gutter: thin coloured bars marking lines that
 * differ from the file's committed (HEAD) version. The HEAD text is fetched in
 * Rust (`git_file_head_content`) and pushed in via `setHeadContent`; the diff
 * is recomputed client-side on every doc change. Nothing here mutates the file
 * or the working tree — it only observes.
 */
export const setHeadContent = StateEffect.define<string | null>();

/** Skip diffing very large buffers to keep typing responsive. */
const MAX_DIFF_BYTES = 2_000_000;

type DiffType = "added" | "modified" | "deleted";

class DiffMarker extends GutterMarker {
  constructor(readonly kind: DiffType) {
    super();
  }
  override toDOM() {
    const el = document.createElement("div");
    el.className = `mcx-diff-bar mcx-diff-${this.kind}`;
    return el;
  }
}

// Markers are immutable, so a single instance per kind can be shared.
const MARKER: Record<DiffType, DiffMarker> = {
  added: new DiffMarker("added"),
  modified: new DiffMarker("modified"),
  deleted: new DiffMarker("deleted"),
};

interface GutterValue {
  head: string | null;
  markers: RangeSet<GutterMarker>;
}

function computeMarkers(head: string | null, doc: Text): RangeSet<GutterMarker> {
  if (head == null || doc.length > MAX_DIFF_BYTES) return RangeSet.empty;
  const current = doc.toString();
  if (head === current) return RangeSet.empty;

  const changes = diff(head, current);
  // line.from → strongest diff type seen for that line.
  const byLine = new Map<number, DiffType>();
  const mark = (from: number, kind: DiffType) => {
    const existing = byLine.get(from);
    if (existing === "added" || existing === "modified") return; // keep stronger
    byLine.set(from, kind);
  };

  for (const c of changes) {
    if (c.fromB === c.toB) {
      // Pure deletion — flag the line where the removed text used to be.
      const line = doc.lineAt(Math.min(c.fromB, doc.length));
      mark(line.from, "deleted");
      continue;
    }
    const kind: DiffType = c.fromA === c.toA ? "added" : "modified";
    const startLine = doc.lineAt(c.fromB).number;
    const endLine = doc.lineAt(Math.max(c.fromB, c.toB - 1)).number;
    for (let n = startLine; n <= endLine; n++) {
      mark(doc.line(n).from, kind);
    }
  }

  const builder = new RangeSetBuilder<GutterMarker>();
  for (const from of [...byLine.keys()].sort((a, b) => a - b)) {
    builder.add(from, from, MARKER[byLine.get(from)!]);
  }
  return builder.finish();
}

const gutterField = StateField.define<GutterValue>({
  create() {
    return { head: null, markers: RangeSet.empty };
  },
  update(value, tr) {
    let head = value.head;
    let headChanged = false;
    for (const e of tr.effects) {
      if (e.is(setHeadContent)) {
        head = e.value;
        headChanged = true;
      }
    }
    if (!tr.docChanged && !headChanged) return value;
    return { head, markers: computeMarkers(head, tr.state.doc) };
  },
});

const changeGutter = gutter({
  class: "cm-gitGutter",
  markers: (view) => view.state.field(gutterField).markers,
});

/** The git change gutter extension (state field + gutter renderer). */
export function gitChangeGutter(): Extension {
  return [gutterField, changeGutter];
}
