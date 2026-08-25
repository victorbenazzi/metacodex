import { useEffect, useRef } from "react";
import { X } from "@/components/ui/icons";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { useListReorder } from "@/components/ui/useListReorder";
import { renderTabIcon } from "@/components/tabs/tabChrome";
import { resolveTabTitle, type Tab } from "@/components/tabs/types";
import type { RightWorkbenchTab } from "@/features/side-panel/sidePanel.store";
import { WorkbenchNewMenu, surfaceIcon, surfaceLabelKey } from "./WorkbenchNewMenu";

type StripItem =
  | { key: string; kind: "surface"; surface: RightWorkbenchTab }
  | { key: string; kind: "doc"; tab: Tab };

interface WorkbenchTabBarProps {
  surfaces: RightWorkbenchTab[];
  docs: Tab[];
  activeKey: string | null;
  onSelectSurface: (id: RightWorkbenchTab) => void;
  onSelectDoc: (id: string) => void;
  onCloseSurface: (id: RightWorkbenchTab) => void;
  onCloseDoc: (id: string) => void;
  onMoveSurface: (id: RightWorkbenchTab, toIndex: number) => void;
  onMoveDoc: (id: string, toIndex: number) => void;
  onOpenSurface: (id: RightWorkbenchTab) => void;
  trailing?: React.ReactNode;
}

const DRAG_THRESHOLD_PX = 6;

function PillMark({
  item,
  active,
}: {
  item: StripItem;
  active: boolean;
}) {
  if (item.kind === "surface") {
    return (
      <Icon
        icon={surfaceIcon(item.surface)}
        size={12}
        className={active ? "text-ink" : "text-muted-soft"}
      />
    );
  }
  return renderTabIcon(item.tab, active);
}

export function WorkbenchTabBar({
  surfaces,
  docs,
  activeKey,
  onSelectSurface,
  onSelectDoc,
  onCloseSurface,
  onCloseDoc,
  onMoveSurface,
  onMoveDoc,
  onOpenSurface,
  trailing,
}: WorkbenchTabBarProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragGhostRef = useRef<HTMLDivElement | null>(null);

  const items: StripItem[] = [
    ...surfaces.map((surface) => ({ key: `surface:${surface}`, kind: "surface" as const, surface })),
    ...docs.map((tab) => ({ key: `doc:${tab.id}`, kind: "doc" as const, tab })),
  ];
  const itemKeys = items.map((item) => item.key);

  const drag = useListReorder({
    ids: itemKeys,
    onReorder: (orderedIds, id) => {
      if (id.startsWith("surface:")) {
        const surface = id.slice("surface:".length) as RightWorkbenchTab;
        const surfaceOrder = orderedIds
          .filter((key) => key.startsWith("surface:"))
          .map((key) => key.slice("surface:".length) as RightWorkbenchTab);
        const nextIndex = surfaceOrder.indexOf(surface);
        if (nextIndex >= 0) onMoveSurface(surface, nextIndex);
        return;
      }
      if (!id.startsWith("doc:")) return;
      const docId = id.slice("doc:".length);
      const docOrder = orderedIds
        .filter((key) => key.startsWith("doc:"))
        .map((key) => key.slice("doc:".length));
      const nextIndex = docOrder.indexOf(docId);
      if (nextIndex >= 0) onMoveDoc(docId, nextIndex);
    },
    axis: "x",
    thresholdPx: DRAG_THRESHOLD_PX,
    bodyClass: "is-reordering-tabs",
    dragDisabled: (id) => {
      if (id.startsWith("surface:")) return surfaces.length < 2;
      if (id.startsWith("doc:")) return docs.length < 2;
      return true;
    },
    autoScroll: {
      containerRef: scrollRef,
      edgePx: 36,
      maxPerFrame: 14,
    },
    onPointerMove: ({ x, y }) => {
      const ghost = dragGhostRef.current;
      if (!ghost) return;
      ghost.style.transform = `translate3d(${x + 10}px, ${y - 10}px, 0)`;
    },
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      el.classList.toggle("is-overflowing", el.scrollWidth > el.clientWidth + 1);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items.length]);

  return (
    <div className="relative flex min-w-0 flex-1 items-center">
      <div
        ref={scrollRef}
        className="tab-scroll flex min-w-0 flex-1 items-center overflow-x-auto overflow-y-hidden px-8px"
      >
        {items.map((item) => {
          const active = item.key === activeKey;
          const beingDragged = drag.draggingId === item.key;
          const label =
            item.kind === "surface"
              ? t(surfaceLabelKey(item.surface))
              : resolveTabTitle(item.tab);

          return (
            <div
              key={item.key}
              ref={drag.itemRef(item.key)}
              {...drag.getItemProps(item.key)}
              className="touch-none shrink-0"
            >
              <button
                type="button"
                onClick={() => {
                  if (item.kind === "surface") onSelectSurface(item.surface);
                  else onSelectDoc(item.tab.id);
                }}
                onAuxClick={(e) => {
                  if (e.button !== 1) return;
                  if (item.kind === "surface") onCloseSurface(item.surface);
                  else onCloseDoc(item.tab.id);
                }}
                className={cn(
                  "group flex h-[22px] max-w-[168px] items-center gap-6px rounded-sm px-8px",
                  "select-none text-left text-caption outline-none transition-colors duration-fast",
                  "focus-visible:ring-1 focus-visible:ring-hairline-strong",
                  (item.kind === "surface" ? surfaces.length >= 2 : docs.length >= 2)
                    ? "cursor-grab"
                    : "cursor-pointer",
                  active
                    ? "bg-surface-strong text-ink"
                    : "bg-transparent text-body hover:bg-surface-strong hover:text-ink",
                  beingDragged && "opacity-40",
                )}
                aria-current={active ? "page" : undefined}
              >
                <PillMark item={item} active={active} />
                <span className="min-w-0 flex-1 truncate">{label}</span>
                <span
                  data-no-drag
                  role="button"
                  tabIndex={-1}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (item.kind === "surface") onCloseSurface(item.surface);
                    else onCloseDoc(item.tab.id);
                  }}
                  className={cn(
                    "inline-flex h-[14px] w-[14px] shrink-0 cursor-pointer items-center justify-center rounded-sm",
                    "transition-[opacity,background-color,color] duration-fast",
                    active
                      ? "text-muted opacity-80 hover:bg-canvas hover:text-ink hover:opacity-100"
                      : "text-muted opacity-0 hover:bg-surface-strong hover:text-ink group-hover:opacity-100",
                  )}
                  aria-label={t("tabs.closeTab")}
                >
                  <Icon icon={X} size={10} />
                </span>
              </button>
            </div>
          );
        })}
        <div
          className="relative sticky right-0 z-[6] flex shrink-0 items-center bg-canvas before:pointer-events-none before:absolute before:bottom-0 before:right-full before:top-0 before:w-10px before:bg-gradient-to-r before:from-transparent before:to-canvas"
          data-no-drag
        >
          <WorkbenchNewMenu onOpen={onOpenSurface} />
        </div>
      </div>
      {trailing ? (
        <div className="flex shrink-0 items-center gap-4px bg-canvas pr-6px">{trailing}</div>
      ) : null}

      {drag.draggingId && drag.pointerPos
        ? (() => {
            const dragged = items.find((item) => item.key === drag.draggingId);
            if (!dragged) return null;
            const sourceEl = drag.getItemEl(dragged.key);
            const ghostWidth = sourceEl?.offsetWidth ?? 120;
            const label =
              dragged.kind === "surface"
                ? t(surfaceLabelKey(dragged.surface))
                : resolveTabTitle(dragged.tab);
            return (
              <div
                ref={dragGhostRef}
                aria-hidden
                className="pointer-events-none fixed left-0 top-0 z-[60] flex h-[22px] items-center gap-6px rounded-sm bg-surface-strong px-8px text-caption text-ink shadow-drag will-change-transform"
                style={{
                  width: ghostWidth,
                  maxWidth: ghostWidth,
                  transform: `translate3d(${drag.pointerPos.x + 10}px, ${drag.pointerPos.y - 10}px, 0)`,
                }}
              >
                <PillMark item={dragged} active />
                <span className="min-w-0 flex-1 truncate">{label}</span>
              </div>
            );
          })()
        : null}
    </div>
  );
}
