import { cn } from "@/lib/cn";
import type { BrandIconProps } from "./types";

// The official PNG has ~20% built-in padding around the "A" mark, so a 16px
// render reads visually smaller than the other CLI marks. Bump the rendered
// dimensions so the visible mark matches Claude/Codex's visual mass.
const PADDING_COMPENSATION = 1.25;

export function AntigravityIcon({ size = 16, className }: BrandIconProps) {
  const rendered = Math.round(size * PADDING_COMPENSATION);
  return (
    <img
      src="/Google-Antigravity-Icon-Full-Color.png"
      alt=""
      draggable={false}
      width={rendered}
      height={rendered}
      className={cn("inline-block select-none", className)}
    />
  );
}
