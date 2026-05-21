import { cn } from "@/lib/cn";
import type { BrandIconProps } from "./types";

// The official OpenCode mark is portrait 4:5 (240×300). Rendering that into a
// square slot via <img> letterboxes it, making the icon read visually smaller
// than the rest of the CLI marks. We inline the SVG here with a square viewBox
// crop (centered vertically: y=30..270) so the artwork fills the requested
// size box — visual mass matches Claude/Codex.
//
// Two variants ship for theme-aware fills; we swap them with Tailwind's
// `dark:` variant (configured to fire on [data-theme="dark"]).

const SQUARE_VIEWBOX = "0 30 240 240";
const INNER_PATH = "M180 240H60V120H180V240Z";
const FRAME_PATH = "M180 60H60V240H180V60ZM240 300H0V0H240V300Z";

export function OpenCodeIcon({ size = 16, className }: BrandIconProps) {
  return (
    <>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox={SQUARE_VIEWBOX}
        className={cn("inline-block dark:hidden", className)}
        aria-hidden
      >
        <path d={INNER_PATH} fill="#CFCECD" />
        <path d={FRAME_PATH} fill="#211E1E" fillRule="evenodd" />
      </svg>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox={SQUARE_VIEWBOX}
        className={cn("hidden dark:inline-block", className)}
        aria-hidden
      >
        <path d={INNER_PATH} fill="#4B4646" />
        <path d={FRAME_PATH} fill="#F1ECEC" fillRule="evenodd" />
      </svg>
    </>
  );
}
