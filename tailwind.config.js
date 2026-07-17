// Density-aware pixel spacing scale. `p-10px` / `gap-6px` render as
// calc(Npx * var(--density-multiplier)), so the Density setting (compact /
// comfortable / spacious) flexes the whole chrome rhythm; at comfortable
// (multiplier 1) each class equals its plain px value exactly. Use these for
// chrome padding/margin/gap instead of hardcoded `p-[10px]`. 1-3px stay as
// arbitrary values on purpose: hairline nudges must not scale. New steps must
// ALSO be recognized by tailwind-merge (src/lib/cn.ts handles any `<n>px`
// value, so adding a step here needs no cn.ts change).
const DENSITY_PX_STEPS = [
  4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 32, 40, 56, 64,
];
const densitySpacing = Object.fromEntries(
  DENSITY_PX_STEPS.map((n) => [`${n}px`, `calc(${n}px * var(--density-multiplier))`]),
);

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

        // Semantic surface aliases — express intent (elevation) rather than
        // a specific color value. Defined in tokens.css.
        "surface-0": "var(--surface-0)",
        "surface-1": "var(--surface-1)",
        "surface-2": "var(--surface-2)",
        "surface-3": "var(--surface-3)",

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

        "tab-active": "var(--tab-active-bg)",
        "tab-active-border": "var(--tab-active-border)",
        "tab-active-text": "var(--tab-active-text)",

        // Restrained indigo/lavender accent (active/selected/focus + glow).
        // Token-driven so it stays consistent across every syntax theme.
        accent: "var(--accent)",
        "accent-strong": "var(--accent-strong)",
        "on-accent": "var(--on-accent)",

        success: "var(--success)",
        danger: "var(--danger)",
        warn: "var(--warn)",
        "on-update": "var(--on-update)",
        "update-blue-strong": "var(--update-blue-strong)",
        "win-close": "var(--win-close)",

        // Fixed-media overlays (what's-new hero): absolute in both themes.
        "on-media": "var(--on-media)",
        "media-scrim": "var(--media-scrim)",
        "media-scrim-strong": "var(--media-scrim-strong)",
        "media-ring": "var(--media-ring)",

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
      // Families resolve through the tokens.css vars (single source of truth);
      // font-display was previously unregistered here, so the class silently
      // emitted nothing and hero titles fell back to the sans stack.
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
        display: ["var(--font-display)"],
      },
      fontSize: {
        // Strict 5-tier UI scale + content (prose) + 3 display tiers. Driven
        // by --fs-* tokens. `label` carries no letter-spacing: `tracking-label`
        // is reserved for uppercase micro badges/chips (section titles are
        // sentence case via .editorial-caps). `micro` is the mono metadata
        // tier (badges, counters, timestamps). New tiers MUST also be
        // registered in src/lib/cn.ts or twMerge drops the class silently.
        micro: ["var(--fs-micro)", { lineHeight: "1.4" }],
        label: ["var(--fs-label)", { lineHeight: "1.4" }],
        caption: ["var(--fs-caption)", { lineHeight: "1.4" }],
        ui: ["var(--fs-ui)", { lineHeight: "1.5" }],
        content: ["var(--fs-content)", { lineHeight: "1.6" }],
        title: ["var(--fs-title)", { lineHeight: "1.4", letterSpacing: "-0.005em" }],
        "display-s": ["var(--fs-display-s)", { lineHeight: "1.25", letterSpacing: "-0.012em" }],
        display: ["var(--fs-display)", { lineHeight: "1.1", letterSpacing: "-0.015em" }],
        "display-l": ["var(--fs-display-l)", { lineHeight: "1.02", letterSpacing: "-0.022em" }],
        mono: ["var(--fs-mono)", { lineHeight: "1.5" }],
      },
      letterSpacing: {
        // Uppercase eyebrow tracking. One token, one utility: no more ad-hoc
        // tracking-[0.0Nem] per component.
        label: "var(--tracking-label)",
        // Display-heading tightening for hero surfaces (Welcome, empty
        // states, markdown H1). One utility instead of ad-hoc negative values.
        display: "-0.015em",
      },
      transitionDuration: {
        // Motion tokens are the single source of truth: bare `transition-*`
        // utilities default to --dur-fast instead of Tailwind's 150ms.
        DEFAULT: "var(--dur-fast)",
        fast: "var(--dur-fast)",
        base: "var(--dur-base)",
        drawer: "var(--dur-drawer)",
        slow: "var(--dur-slow)",
      },
      transitionTimingFunction: {
        DEFAULT: "var(--ease-out)",
        out: "var(--ease-out)",
        "in-out": "var(--ease-in-out)",
        drawer: "var(--ease-drawer)",
      },
      borderRadius: {
        xs: "var(--radius-xs)",
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        elevated: "var(--shadow-elevated)",
        drag: "var(--shadow-drag)",
      },
      backgroundColor: {
        // Modal/dialog scrim. Token-driven so light and dark themes can tune
        // alpha independently without component edits.
        scrim: "var(--overlay-scrim)",
      },
      spacing: {
        xxs: "var(--space-xxs)",
        xs: "var(--space-xs)",
        sm: "var(--space-sm)",
        base: "var(--space-base)",
        md: "var(--space-md)",
        lg: "var(--space-lg)",
        xl: "var(--space-xl)",
        ...densitySpacing,
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
        // Tab-status "working" indicator — pure opacity, slow enough not to
        // distract but visible enough to read at a glance. Triangulated by
        // Radix scale tests: 1.6s feels alive, 0.8s feels anxious.
        "tab-status-pulse": {
          "0%, 100%": { opacity: "0.35" },
          "50%": { opacity: "0.85" },
        },
        // Indeterminate progress bar — a 33%-wide fill slides across the track.
        // Used while we haven't received the first percent event yet (e.g. while
        // git is negotiating with the remote before download starts).
        "progress-indeterminate": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(400%)" },
        },
        // Inline control reveal — slides sideways into place (e.g. the
        // reasoning-variant pill appearing beside the model picker). NOT for
        // popups/overlays (those stay opacity-only; see fade-in above): this
        // is in-flow content, so the transform can't break modal centering.
        "slide-in-left": {
          from: { opacity: "0", transform: "translateX(-8px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
      },
      animation: {
        // Enter decelerates in (ease-out); exit accelerates out (ease-in) and
        // is shorter so dismissals feel instant. `forwards` holds opacity:0 on
        // exit until Radix unmounts, preventing a 1-frame flash-back to visible.
        // Durations/easings are tokens — see --dur-enter/--dur-exit in tokens.css.
        "fade-in": "fade-in var(--dur-enter) var(--ease-out)",
        "fade-out": "fade-out var(--dur-exit) var(--ease-in) forwards",
        "tab-status-pulse": "tab-status-pulse 1.6s ease-in-out infinite",
        "progress-indeterminate": "progress-indeterminate 1.4s linear infinite",
        "slide-in-left": "slide-in-left 180ms var(--ease-out) both",
      },
    },
  },
  plugins: [],
};
