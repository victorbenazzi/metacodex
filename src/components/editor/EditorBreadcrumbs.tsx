import { ChevronRight } from "lucide-react";

import { useEditorStatusStore } from "@/features/editor/editor-status.store";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

const EMPTY: string[] = [];

/**
 * Thin breadcrumb strip at the top of the editor: the file name followed by the
 * chain of enclosing code scopes at the cursor (e.g. `AppShell.tsx › AppShell ›
 * handleOpenFile`). Persistent height so the editor doesn't jump as crumbs change.
 */
export function EditorBreadcrumbs({ tabId, fileName }: { tabId: string; fileName: string }) {
  const crumbs = useEditorStatusStore((s) => s.byTab[tabId]?.crumbs) ?? EMPTY;
  const parts = [fileName, ...crumbs];
  return (
    <div className="flex h-[24px] shrink-0 items-center overflow-hidden border-b border-hairline-soft bg-canvas px-[12px] text-label text-muted">
      {parts.map((p, i) => (
        <span key={i} className="flex shrink-0 items-center">
          {i > 0 ? (
            <Icon icon={ChevronRight} size={11} className="mx-[1px] text-muted-soft" />
          ) : null}
          <span className={cn(i === parts.length - 1 && i > 0 ? "text-ink" : "")}>{p}</span>
        </span>
      ))}
    </div>
  );
}
