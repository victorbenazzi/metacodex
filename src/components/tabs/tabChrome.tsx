import type { ReactNode } from "react";
import { TerminalSquare, GitCompare } from "@/components/ui/icons";

import { Icon } from "@/components/ui/Icon";
import { FileIcon } from "@/components/file-explorer/FileIcon";
import { CLI_BRAND_ICONS } from "@/components/icons/brand";
import type { Tab } from "./types";

export const TAB_RADIUS_PACKED = 2;
export const TAB_RADIUS_OPEN = 8;
export const TAB_MORPH_GAP_PX = 28;
export const TAB_LIFT_PX = 14;

export function renderTabIcon(tab: Tab, active: boolean): ReactNode {
  const tone = active ? "text-tab-active-text" : "text-muted-soft";

  if (tab.kind === "terminal") {
    return <Icon icon={TerminalSquare} size={12} className={tone} />;
  }
  if (tab.kind === "cli") {
    const BrandIcon = CLI_BRAND_ICONS[tab.cliId];
    if (BrandIcon) {
      return (
        <span className="inline-flex h-[12px] w-[12px] shrink-0 items-center justify-center">
          <BrandIcon size={12} />
        </span>
      );
    }
    return <Icon icon={TerminalSquare} size={12} className={tone} />;
  }
  if (tab.kind === "diff" || tab.kind === "changes") {
    return <Icon icon={GitCompare} size={12} className={tone} />;
  }
  if (tab.kind === "editor" || tab.kind === "markdown" || tab.kind === "image" || tab.kind === "pdf") {
    return (
      <FileIcon isDir={false} filename={tab.path} size={12} className={tone} />
    );
  }
  return <Icon icon={TerminalSquare} size={12} className={tone} />;
}

export function radiusFromGap(gap: number): number {
  const t = Math.min(1, Math.max(0, gap / TAB_MORPH_GAP_PX));
  const s = t * t * (3 - 2 * t);
  return TAB_RADIUS_PACKED + s * (TAB_RADIUS_OPEN - TAB_RADIUS_PACKED);
}

export function setTabRadii(el: HTMLElement, left: number, right: number): void {
  el.style.setProperty("--tab-rl", `${left}px`);
  el.style.setProperty("--tab-rr", `${right}px`);
}

/** Distance-to-progress radii for a dragged ghost vs the live strip. */
export function syncGhostRadii(
  ghost: HTMLElement,
  getItemEl: (id: string) => HTMLElement | null,
  ids: string[],
  draggingId: string | null,
): void {
  const ghostRect = ghost.getBoundingClientRect();
  const others = ids.filter((id) => id !== draggingId);
  let nearestLeft: DOMRect | null = null;
  let nearestRight: DOMRect | null = null;

  for (const id of others) {
    const el = getItemEl(id);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    const stripMidY = rect.top + rect.height / 2;
    const lift = Math.abs(ghostRect.top + ghostRect.height / 2 - stripMidY);
    if (lift > TAB_LIFT_PX * 3) continue;
    if (rect.right <= ghostRect.left + ghostRect.width / 2) {
      if (!nearestLeft || rect.right > nearestLeft.right) nearestLeft = rect;
    }
    if (rect.left >= ghostRect.left + ghostRect.width / 2) {
      if (!nearestRight || rect.left < nearestRight.left) nearestRight = rect;
    }
  }

  const lift = (() => {
    const sample = others[0] ? getItemEl(others[0]) : null;
    if (!sample) return TAB_LIFT_PX;
    const rect = sample.getBoundingClientRect();
    return Math.abs(ghostRect.top + ghostRect.height / 2 - (rect.top + rect.height / 2));
  })();

  if (lift > TAB_LIFT_PX) {
    setTabRadii(ghost, TAB_RADIUS_OPEN, TAB_RADIUS_OPEN);
    return;
  }

  const gapL = nearestLeft ? ghostRect.left - nearestLeft.right : TAB_MORPH_GAP_PX;
  const gapR = nearestRight ? nearestRight.left - ghostRect.right : TAB_MORPH_GAP_PX;
  setTabRadii(ghost, radiusFromGap(gapL), radiusFromGap(gapR));
}
