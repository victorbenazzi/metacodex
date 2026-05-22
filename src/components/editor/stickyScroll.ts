import { ViewPlugin, EditorView, type ViewUpdate } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import { scopesAt } from "./codeScopes";

/**
 * Sticky scroll: pins the header lines of the code scopes enclosing the top of
 * the viewport (function/class/method, etc.) as you scroll, so you keep context
 * in long files. Read-only; clicking a pinned header jumps to it.
 *
 * The overlay is absolutely positioned over the top of the editor and aligned to
 * the content via the measured gutter width. Visual positioning is best verified
 * in the running app.
 */
export const stickyScroll: Extension = ViewPlugin.fromClass(
  class {
    dom: HTMLElement;
    view: EditorView;
    left = 0;
    onScroll: () => void;

    constructor(view: EditorView) {
      this.view = view;
      this.dom = document.createElement("div");
      this.dom.className = "cm-stickyScroll";
      this.dom.style.display = "none";
      view.dom.appendChild(this.dom);
      this.onScroll = () => this.render();
      view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
      requestAnimationFrame(() => {
        this.measure();
        this.render();
      });
    }

    update(u: ViewUpdate) {
      if (u.geometryChanged) this.measure();
      if (u.docChanged || u.viewportChanged || u.geometryChanged) this.render();
    }

    measure() {
      const gutters = this.view.dom.querySelector(".cm-gutters") as HTMLElement | null;
      this.left = gutters ? gutters.offsetWidth : 0;
    }

    render() {
      const view = this.view;
      const top = view.scrollDOM.scrollTop;
      let headPos: number;
      try {
        headPos = view.lineBlockAtHeight(top).from;
      } catch {
        return;
      }
      // Read live so changing the setting takes effect on the next scroll/render.
      // 0 (or less) disables sticky scroll entirely — guard before slice(-max),
      // since slice(-0) would otherwise keep the whole array.
      const max = useSettingsDataStore.getState().settings.editor.stickyScrollMaxHeaders;
      const scopes =
        max <= 0
          ? []
          : scopesAt(view.state, headPos)
              .filter((s) => {
                try {
                  return view.lineBlockAt(s.from).top < top - 1;
                } catch {
                  return false;
                }
              })
              .slice(-max);

      if (scopes.length === 0) {
        this.dom.style.display = "none";
        this.dom.replaceChildren();
        return;
      }

      this.dom.style.left = `${this.left}px`;
      this.dom.style.display = "block";
      const rows = scopes.map((s) => {
        const row = document.createElement("div");
        row.className = "cm-stickyScroll-row";
        row.textContent = view.state.doc.line(s.line).text || " ";
        row.addEventListener("mousedown", (e) => {
          e.preventDefault();
          view.dispatch({
            selection: { anchor: s.from },
            effects: EditorView.scrollIntoView(s.from, { y: "start" }),
          });
        });
        return row;
      });
      this.dom.replaceChildren(...rows);
    }

    destroy() {
      this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
      this.dom.remove();
    }
  },
);
