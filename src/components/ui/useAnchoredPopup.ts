import {
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useFloating,
  type Placement,
  type Strategy,
} from "@floating-ui/react";

/**
 * Collision-aware positioning for CUSTOM (non-Radix) floating panels: popovers,
 * flyouts, inline autocompletes. Radix primitives already flip/shift AND bring a
 * submenu "grace area" (safe triangle) for free, so reach for this only when a
 * panel can't be a Radix menu (e.g. it must keep input focus in a textarea, like
 * MentionPopup / AvatarPicker). Mirrors the Radix wrappers' 8px edge margin so a
 * panel near a viewport edge flips to the opposite side and never touches it.
 *
 * Defaults to the "absolute" strategy so the panel can live inside its anchor's
 * positioned parent with NO portal (click-outside via the anchor subtree keeps
 * working). For a panel that must escape a transformed ancestor, pass
 * strategy "fixed" AND render it through FloatingPortal, otherwise
 * `position: fixed` resolves against the transform instead of the viewport.
 *
 * Positioning only: wire open/dismiss/keyboard yourself, or add Floating UI's
 * `useHover` + `safePolygon` if you ever build a hover-driven cascading flyout.
 */

const EDGE_PADDING = 8;

export interface AnchoredPopupOptions {
  /** Whether the panel is mounted/open (gates the autoUpdate listeners). */
  open: boolean;
  placement?: Placement;
  strategy?: Strategy;
  /** Gap in px between the anchor and the panel. */
  gap?: number;
  /** Min distance kept from the viewport edges (flip/shift/size padding). */
  padding?: number;
  /** Cap the panel height to the available space (it must scroll internally). */
  constrainHeight?: boolean;
  /** Match the panel width to the anchor width. */
  matchAnchorWidth?: boolean;
}

export function useAnchoredPopup({
  open,
  placement = "bottom-start",
  strategy = "absolute",
  gap = 6,
  padding = EDGE_PADDING,
  constrainHeight = true,
  matchAnchorWidth = false,
}: AnchoredPopupOptions) {
  return useFloating({
    open,
    placement,
    strategy,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(gap),
      flip({ padding }),
      shift({ padding }),
      size({
        padding,
        apply({ availableHeight, rects, elements }) {
          if (constrainHeight) {
            elements.floating.style.maxHeight = `${Math.max(140, Math.floor(availableHeight))}px`;
          }
          if (matchAnchorWidth) {
            elements.floating.style.width = `${Math.round(rects.reference.width)}px`;
          }
        },
      }),
    ],
  });
}
