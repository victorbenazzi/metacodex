import clsx, { type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The custom fontSize tiers from tailwind.config.js must be declared here:
// without this, tailwind-merge classifies text-ui/text-label/etc. as text
// COLORS, so cn("text-ui", "text-muted") would silently drop the font size.

// Density spacing values ("6px" in gap-6px / p-10px, from the density-aware
// scale in tailwind.config.js). Without this validator tailwind-merge treats
// those classes as unknown, so cn("p-8px", "p-10px") would keep both.
const isDensityPx = (value: string) => /^\d+px$/.test(value);
const spacingScale = ["xxs", "xs", "sm", "base", "md", "lg", "xl", isDensityPx];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      p: [{ p: spacingScale }],
      px: [{ px: spacingScale }],
      py: [{ py: spacingScale }],
      pt: [{ pt: spacingScale }],
      pr: [{ pr: spacingScale }],
      pb: [{ pb: spacingScale }],
      pl: [{ pl: spacingScale }],
      m: [{ m: spacingScale }],
      mx: [{ mx: spacingScale }],
      my: [{ my: spacingScale }],
      mt: [{ mt: spacingScale }],
      mr: [{ mr: spacingScale }],
      mb: [{ mb: spacingScale }],
      ml: [{ ml: spacingScale }],
      gap: [{ gap: spacingScale }],
      "gap-x": [{ "gap-x": spacingScale }],
      "gap-y": [{ "gap-y": spacingScale }],
      "space-x": [{ "space-x": spacingScale }],
      "space-y": [{ "space-y": spacingScale }],
      "font-size": [
        {
          text: [
            "micro",
            "label",
            "caption",
            "ui",
            "content",
            "title",
            "display-s",
            "display",
            "display-l",
            "mono",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
