import clsx, { type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The custom fontSize tiers from tailwind.config.js must be declared here:
// without this, tailwind-merge classifies text-ui/text-label/etc. as text
// COLORS, so cn("text-ui", "text-muted") would silently drop the font size.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
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
