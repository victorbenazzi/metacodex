import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

export interface CodeScope {
  name: string;
  /** Document position where the scope node starts. */
  from: number;
  /** 1-based line number of the scope header. */
  line: number;
}

// Minimal shape of a Lezer SyntaxNode (avoids depending on @lezer/common directly).
interface TreeNode {
  type: { name: string };
  from: number;
  to: number;
  parent: TreeNode | null;
  firstChild: TreeNode | null;
  nextSibling: TreeNode | null;
}

const SCOPE_RE = /(Declaration|Definition|Function|Class|Method|Interface|Enum|Namespace|Module)/;
const NAME_RE = /(Definition|Name)$/;

/**
 * Enclosing named code scopes at `pos`, outermost first. A heuristic over the
 * Lezer syntax tree — tuned for the JS/TS family (whose node names end in
 * Declaration/Definition with a VariableDefinition/PropertyDefinition child),
 * degrading gracefully (fewer/no crumbs) for grammars it doesn't recognise.
 */
export function scopesAt(state: EditorState, pos: number): CodeScope[] {
  const tree = syntaxTree(state);
  let node = tree.resolveInner(pos, -1) as unknown as TreeNode | null;
  const scopes: CodeScope[] = [];
  const seen = new Set<number>();
  while (node) {
    if (SCOPE_RE.test(node.type.name)) {
      const name = extractName(state, node);
      if (name && !seen.has(node.from)) {
        seen.add(node.from);
        scopes.push({ name, from: node.from, line: state.doc.lineAt(node.from).number });
      }
    }
    node = node.parent;
  }
  return scopes.reverse();
}

function extractName(state: EditorState, node: TreeNode): string | null {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (NAME_RE.test(child.type.name)) {
      const text = state.sliceDoc(child.from, child.to).trim();
      if (text) return text.length > 40 ? text.slice(0, 40) + "…" : text;
    }
  }
  return null;
}
