import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { FolderOpen, FolderPlus, Github, Settings, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/ui/Icon";
import { Tooltip } from "@/components/ui/Tooltip";
import { Kbd } from "@/components/ui/Kbd";
import { Button } from "@/components/ui/Button";
import {
  DialogContent,
  DialogRoot,
} from "@/components/ui/Dialog";
import {
  DropdownContent,
  DropdownItem,
  DropdownRoot,
  DropdownTrigger,
} from "@/components/ui/DropdownMenu";
import { ProjectTile } from "./ProjectTile";
import { ProjectContextMenu } from "./ProjectContextMenu";
import { RenameProjectDialog } from "./RenameProjectDialog";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { useProjectsStore } from "@/features/projects/project.store";
import { useSettingsStore } from "@/features/settings/settings.store";
import type { Project } from "@/features/projects/project.types";
import { cn } from "@/lib/cn";

interface MiniProjectSidebarProps {
  onOpenFolder: () => void;
  onCloneFromGithub: () => void;
}

// Minimum pointer travel before a press becomes a drag. Below this, the press
// is treated as a click (setActive). 8px is roomy enough to absorb the small
// pointer oscillation a MacBook trackpad emits during a deliberate tap — at
// 4px those taps were silently flipping into "drag" mode and suppressing the
// click, which is the "I can't switch projects" symptom on trackpad users.
const DRAG_THRESHOLD_PX = 8;

export function MiniProjectSidebar({ onOpenFolder, onCloneFromGithub }: MiniProjectSidebarProps) {
  const { t } = useTranslation();
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const setActive = useProjectsStore((s) => s.setActive);
  const remove = useProjectsStore((s) => s.remove);
  const reorder = useProjectsStore((s) => s.reorder);

  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Project | null>(null);
  const settingsOpen = useSettingsStore((s) => s.open);
  const setSettingsOpen = useSettingsStore((s) => s.setOpen);

  // Drag state.
  //  - draggingId: the project currently being dragged (drives the dim-in-place + ghost).
  //  - dropIndex: insertion slot (0..projects.length) where the dragged tile would land.
  //  - pointerPos: viewport-space pointer position used to anchor the ghost.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [pointerPos, setPointerPos] = useState<{ x: number; y: number } | null>(null);
  // Set by pointermove when the gesture escalates to a drag; drained by the
  // next click on the same tile so a drop doesn't also activate the project.
  const suppressClickRef = useRef(false);
  // Timestamp of the most recent pointerup-driven activation. Lets the
  // onClick handler bail when the click fires right after the pointerup
  // (the common path on platforms where the click event isn't broken) —
  // and gracefully degrade when click never arrives (WKWebView + composed
  // Radix Slots), since the timestamp is naturally stale by the next press.
  const lastPointerActivationRef = useRef(0);

  // One DOM ref per tile wrapper. Used during drag to compute which gap the
  // pointer is currently over and where to draw the drop indicator.
  const tileRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const railRef = useRef<HTMLDivElement | null>(null);
  const setTileRef = (id: string) => (el: HTMLDivElement | null) => {
    if (el) tileRefs.current.set(id, el);
    else tileRefs.current.delete(id);
  };

  // Global cursor while dragging — applied as a body class so EVERY element
  // (including buttons that opt into cursor:pointer) shows the grabbing cursor.
  useEffect(() => {
    if (!draggingId) return;
    document.body.classList.add("is-reordering-projects");
    return () => {
      document.body.classList.remove("is-reordering-projects");
    };
  }, [draggingId]);

  const computeDropIndex = (clientY: number): number => {
    // Walk visible tiles top-down; the first one whose midpoint sits below the
    // pointer is the insertion slot. Falling through past all of them means
    // "append to end".
    for (let i = 0; i < projects.length; i++) {
      const el = tileRefs.current.get(projects[i].id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return projects.length;
  };

  const onTilePointerDown =
    (id: string) => (e: RPointerEvent<HTMLDivElement>) => {
      // Only left-button presses initiate drag. Right-click falls through to
      // the Radix ContextMenu trigger nested inside; middle/etc. are ignored.
      if (e.button !== 0) return;
      // Skip when the press originated on an interactive overlay (e.g. the
      // context menu itself was open and the click closes it). Heuristic:
      // [data-radix-*] descendants.
      const target = e.target as HTMLElement | null;
      if (target?.closest("[role=menu]")) return;

      // IMPORTANT: do NOT call setPointerCapture here. In WKWebView, capturing
      // a pointer on this wrapper div consistently SUPPRESSES the `click`
      // event on the nested <button> (which is asChild'd by TooltipTrigger +
      // ContextMenuTrigger — two composed Radix Slots, a known-broken combo
      // in WKWebView per MEMORY's "Drag = pointer events" note). Without
      // capture, window-level pointermove/pointerup listeners are enough to
      // track the gesture, and the child button's onClick fires normally.
      // For drags that escape the rail bounds, window listeners receive the
      // events anyway — capture is unnecessary.

      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;
      let localDropIndex: number | null = null;

      const onMove = (ev: PointerEvent) => {
        if (!dragging) {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          dragging = true;
          suppressClickRef.current = true;
          setDraggingId(id);
        }
        const idx = computeDropIndex(ev.clientY);
        localDropIndex = idx;
        setDropIndex(idx);
        setPointerPos({ x: ev.clientX, y: ev.clientY });
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
      };

      const onUp = () => {
        cleanup();
        if (dragging && localDropIndex != null) {
          const sourceIdx = projects.findIndex((p) => p.id === id);
          // Drops at the source's own slots (`i` and `i+1`) are no-ops; skip.
          if (
            sourceIdx >= 0 &&
            localDropIndex !== sourceIdx &&
            localDropIndex !== sourceIdx + 1
          ) {
            const ids = projects.map((p) => p.id);
            const [moved] = ids.splice(sourceIdx, 1);
            const insertAt =
              localDropIndex > sourceIdx ? localDropIndex - 1 : localDropIndex;
            ids.splice(insertAt, 0, moved);
            void reorder(ids);
          }
        } else if (!dragging) {
          // Belt-and-suspenders: even though there's no pointer capture in
          // play, Radix Slot composition has been known to swallow the
          // child button's click. Activating from pointerup guarantees the
          // project actually switches. The lastPointerActivation timestamp
          // gate below prevents double-fire when the click DOES arrive.
          lastPointerActivationRef.current = performance.now();
          void setActive(id);
        }
        setDraggingId(null);
        setDropIndex(null);
        setPointerPos(null);
      };

      const onCancel = () => {
        cleanup();
        setDraggingId(null);
        setDropIndex(null);
        setPointerPos(null);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    };

  const onTileClick = (id: string) => () => {
    // Drag end already fired setActive — don't double-activate.
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    // pointerup already activated within the last 250ms — skip. After 250ms,
    // assume this is a genuine standalone click (e.g. keyboard Enter on a
    // focused tile, where there was no pointerup).
    if (performance.now() - lastPointerActivationRef.current < 250) return;
    void setActive(id);
  };

  // Indicator visibility: hide on the two slots adjacent to the source tile,
  // since dropping there is a no-op (and the visual line would be misleading).
  const sourceIdx = draggingId
    ? projects.findIndex((p) => p.id === draggingId)
    : -1;
  const showDropIndicator =
    draggingId !== null &&
    dropIndex !== null &&
    dropIndex !== sourceIdx &&
    dropIndex !== sourceIdx + 1;

  const indicatorY = (() => {
    if (!showDropIndicator || dropIndex === null || !railRef.current) return null;
    if (dropIndex === projects.length) {
      const last = projects[projects.length - 1];
      const el = last ? tileRefs.current.get(last.id) : null;
      if (!el) return null;
      return el.offsetTop + el.offsetHeight + 3;
    }
    const target = projects[dropIndex];
    const el = target ? tileRefs.current.get(target.id) : null;
    if (!el) return null;
    return el.offsetTop - 5;
  })();

  const draggingProject = draggingId
    ? projects.find((p) => p.id === draggingId) ?? null
    : null;

  return (
    <>
      <aside
        className="relative flex h-full w-full flex-col items-center overflow-hidden border-r border-hairline bg-canvas-soft"
        aria-label={t("projectRail.ariaLabel")}
      >
        <div
          ref={railRef}
          className="relative flex flex-1 flex-col items-center gap-[8px] overflow-y-auto overflow-x-hidden px-[8px] py-[14px]"
        >
          {/* Drop indicator — absolutely positioned in the rail's flow so the
              surrounding tiles don't reflow as the pointer moves between gaps.
              Bookended with two small caps to give the line a deliberate,
              non-default look that reads at a glance against any tile color. */}
          {indicatorY !== null ? (
            <span
              aria-hidden
              className="pointer-events-none absolute left-[6px] right-[6px] flex items-center"
              style={{ top: `${indicatorY - 1}px`, height: "3px" }}
            >
              <span className="h-[6px] w-[6px] -ml-[1px] rounded-full bg-ink" />
              <span className="h-[2px] flex-1 bg-ink" />
              <span className="h-[6px] w-[6px] -mr-[1px] rounded-full bg-ink" />
            </span>
          ) : null}

          {projects.map((p) => {
            const isBeingDragged = draggingId === p.id;
            return (
              <div
                key={p.id}
                ref={setTileRef(p.id)}
                onPointerDown={onTilePointerDown(p.id)}
                // touch-action: none prevents the WebView from interpreting
                // vertical pointer drags as page scroll, which would cancel
                // pointermove before we cross the drag threshold.
                className={cn(
                  "relative touch-none transition-opacity duration-150",
                  isBeingDragged ? "opacity-30" : "opacity-100",
                  // cursor: grab signals draggability; switches to grabbing
                  // globally via body.is-reordering-projects.
                  "cursor-grab active:cursor-grabbing",
                )}
              >
                <ProjectContextMenu
                  project={p}
                  onRequestRename={() => setRenameTarget(p)}
                  onRequestRemove={() => setRemoveTarget(p)}
                >
                  <ProjectTile
                    project={p}
                    active={p.id === activeProjectId}
                    isDragging={false}
                    onClick={onTileClick(p.id)}
                  />
                </ProjectContextMenu>
              </div>
            );
          })}
        </div>

        <div className="flex w-full shrink-0 flex-col items-center gap-[6px] border-t border-hairline-soft py-[10px]">
          <DropdownRoot>
            <Tooltip content={t("projectRail.addProject")} side="right">
              <DropdownTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-[32px] w-[32px] items-center justify-center rounded-sm",
                    "text-muted hover:bg-surface-strong/55 hover:text-ink transition-colors",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[2px]",
                    "data-[state=open]:bg-surface-strong/55 data-[state=open]:text-ink",
                  )}
                  aria-label={t("projectRail.addProject")}
                >
                  <Icon icon={FolderPlus} size={15} />
                </button>
              </DropdownTrigger>
            </Tooltip>
            <DropdownContent align="start" sideOffset={8}>
              <DropdownItem
                onSelect={onOpenFolder}
                trailing={<Kbd keys={["Mod", "O"]} />}
              >
                <Icon icon={FolderOpen} size={13} className="text-muted" />
                {t("welcome.openProjectMenu.local")}
              </DropdownItem>
              <DropdownItem
                onSelect={onCloneFromGithub}
                trailing={<Kbd keys={["Mod", "Shift", "O"]} />}
              >
                <Icon icon={Github} size={13} className="text-muted" />
                {t("welcome.openProjectMenu.github")}
              </DropdownItem>
            </DropdownContent>
          </DropdownRoot>

          <Tooltip content={t("projectRail.settings")} shortcut={<Kbd keys={["Mod", ","]} />} side="right">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className={cn(
                "inline-flex h-[32px] w-[32px] items-center justify-center rounded-sm",
                "text-muted hover:bg-surface-strong/55 hover:text-ink transition-colors",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[2px]",
              )}
              aria-label={t("projectRail.openSettings")}
            >
              <Icon icon={Settings} size={14} />
            </button>
          </Tooltip>
        </div>
      </aside>

      {/* Floating drag ghost — viewport-fixed and pointer-events:none so it
          glides under the cursor without intercepting events from the rail. */}
      {draggingProject && pointerPos ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[1000]"
          style={{
            top: pointerPos.y,
            left: pointerPos.x,
            transform: "translate(-50%, -50%) rotate(-3deg)",
          }}
        >
          <div className="rounded-md shadow-drag">
            <ProjectTile
              project={draggingProject}
              active={draggingProject.id === activeProjectId}
              isDragging={false}
              onClick={() => undefined}
            />
          </div>
        </div>
      ) : null}

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      <RenameProjectDialog
        project={renameTarget}
        open={!!renameTarget}
        onOpenChange={(o) => !o && setRenameTarget(null)}
      />

      <DialogRoot
        open={!!removeTarget}
        onOpenChange={(o) => !o && setRemoveTarget(null)}
      >
        {removeTarget && (
          <DialogContent
            title={t("projectRail.removeTitle")}
            description={t("projectRail.removeDescription")}
            width={420}
            footer={
              <>
                <Button variant="outline" size="sm" onClick={() => setRemoveTarget(null)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={async () => {
                    const target = removeTarget;
                    setRemoveTarget(null);
                    await remove(target.id);
                  }}
                  className="bg-danger text-on-primary hover:bg-danger/85"
                >
                  <Icon icon={Trash2} size={12} className="text-on-primary" />
                  {t("common.remove")}
                </Button>
              </>
            }
          >
            <div className="space-y-[8px]">
              <p className="text-[13px] text-body">
                <span className="font-medium text-ink">{removeTarget.name}</span>{t("projectRail.removeBodySuffix")}
              </p>
              <p className="font-mono text-[11px] text-muted-soft">{removeTarget.path}</p>
            </div>
          </DialogContent>
        )}
      </DialogRoot>
    </>
  );
}
