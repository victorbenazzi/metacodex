/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: "var(--canvas)",
        "canvas-soft": "var(--canvas-soft)",
        "surface-card": "var(--surface-card)",
        "surface-strong": "var(--surface-strong)",

        hairline: "var(--hairline)",
        "hairline-soft": "var(--hairline-soft)",
        "hairline-strong": "var(--hairline-strong)",

        ink: "var(--ink)",
        body: "var(--body)",
        muted: "var(--muted)",
        "muted-soft": "var(--muted-soft)",

        primary: "var(--primary)",
        "primary-active": "var(--primary-active)",
        "on-primary": "var(--on-primary)",

        success: "var(--success)",
        danger: "var(--danger)",
        warn: "var(--warn)",

        // Project palette swatches (warm/neutral)
        "p-1": "#7c7666",
        "p-2": "#8a6f4c",
        "p-3": "#6f7a6a",
        "p-4": "#7a6470",
        "p-5": "#5f6e7a",
        "p-6": "#806a5a",
        "p-7": "#6a6b6f",
        "p-8": "#73716a",
      },
      borderColor: {
        DEFAULT: "var(--hairline)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "sans-serif"],
        mono: ['"JetBrains Mono"', '"SF Mono"', "ui-monospace", "Menlo", "monospace"],
      },
      fontSize: {
        ui: ["14px", { lineHeight: "1.5" }],
        caption: ["12px", { lineHeight: "1.4" }],
        mono: ["13px", { lineHeight: "1.5" }],
      },
      borderRadius: {
        xs: "var(--radius-xs)",
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        pill: "var(--radius-pill)",
      },
      spacing: {
        xxs: "var(--space-xxs)",
        xs: "var(--space-xs)",
        sm: "var(--space-sm)",
        base: "var(--space-base)",
        md: "var(--space-md)",
        lg: "var(--space-lg)",
        xl: "var(--space-xl)",
      },
      keyframes: {
        // Unified popup motion — pure opacity, no transform. Every overlay,
        // dialog, menu, dropdown, palette and tooltip shares this single pair.
        // Opacity-only is deliberate: a transform here would override the
        // -translate-x/-translate-y centering on modal content (which made
        // dialogs animate off-center and snap into place).
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "fade-out": {
          from: { opacity: "1" },
          to: { opacity: "0" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        // Enter decelerates in (ease-out); exit accelerates out (ease-in) and
        // is shorter so dismissals feel instant. `forwards` holds opacity:0 on
        // exit until Radix unmounts, preventing a 1-frame flash-back to visible.
        // Durations/easings are tokens — see --dur-enter/--dur-exit in tokens.css.
        "fade-in": "fade-in var(--dur-enter) var(--ease-out)",
        "fade-out": "fade-out var(--dur-exit) var(--ease-in) forwards",
      },
    },
  },
  plugins: [],
};
