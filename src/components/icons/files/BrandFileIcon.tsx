import { useMemo } from "react";
import type { SimpleIcon } from "simple-icons";

import { useThemeStore } from "@/features/theme/theme.store";
import { cn } from "@/lib/cn";

/**
 * Renders a Simple Icons brand SVG inline. Simple Icons paths fill their 24×24
 * viewBox edge-to-edge, while Lucide icons reserve ~1.5px of internal padding —
 * so we inset the viewBox by 2px on each side to keep brand marks visually
 * balanced next to Lucide icons in the explorer (otherwise the brand icon reads
 * larger at the same `size` prop).
 *
 * When `colored` is on the brand's canonical hex is used, but we nudge its HSL
 * lightness toward a theme-safe range so very dark brands (Markdown, Express,
 * Apple → near-black) don't vanish on a dark canvas, and very light brands
 * (React, Webpack → pale cyan) don't wash out on a light canvas. Hue is
 * preserved so the mark still reads as itself.
 */
export function BrandFileIcon({
  icon,
  colored,
  size = 13,
  className,
}: {
  icon: SimpleIcon;
  colored: boolean;
  size?: number;
  className?: string;
}) {
  const isDark = useThemeStore((s) => s.effective === "dark");

  const fill = useMemo(() => {
    if (!colored) return "currentColor";
    return `#${themeSafeBrandHex(icon.hex, isDark)}`;
  }, [colored, icon.hex, isDark]);

  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg
        width={size}
        height={size}
        viewBox="-2 -2 28 28"
        role="img"
        aria-label={icon.title}
      >
        <path d={icon.path} fill={fill} />
      </svg>
    </span>
  );
}

/** Lightness ceilings/floors for the brand hex in each theme kind. Values
 *  picked so 13px solid glyphs hold ≥3:1 against canvas without flattening
 *  the brand identity (a saturated red still reads as red). */
const DARK_MIN_L = 0.55;
const LIGHT_MAX_L = 0.45;

function themeSafeBrandHex(hex: string, isDark: boolean): string {
  const [h, s, l] = hexToHsl(hex);
  if (isDark && l < DARK_MIN_L) return hslToHex(h, s, DARK_MIN_L);
  if (!isDark && l > LIGHT_MAX_L) return hslToHex(h, s, LIGHT_MAX_L);
  return hex;
}

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case r:
      h = (g - b) / d + (g < b ? 6 : 0);
      break;
    case g:
      h = (b - r) / d + 2;
      break;
    default:
      h = (r - g) / d + 4;
  }
  return [h / 6, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, h + 1 / 3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1 / 3);
  }
  return [r, g, b]
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
}

function hueToRgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
