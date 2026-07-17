import type { BrandIconProps } from "./types";

// Kimi (Moonshot) brand mark, sourced from @lobehub/icons (lobehub.com/icons/kimi).
// The canonical "Color" mark is a white swoosh + blue accent dot designed to sit
// on a dark ground, so on its own it would vanish on the light theme. We render
// lobehub's Avatar composition instead: the brand's black rounded square with the
// mark scaled to 0.6 and centered — self-contained and legible on both themes,
// matching how the real Kimi app icon reads anywhere.
export function KimiIcon({ size = 16, className }: BrandIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden
    >
      <rect width="24" height="24" rx="5" fill="#000" />
      <g transform="translate(4.8 4.8) scale(0.6)">
        <path
          fill="#1783FF"
          d="M21.846 0a1.923 1.923 0 110 3.846H20.15a.226.226 0 01-.227-.226V1.923C19.923.861 20.784 0 21.846 0z"
        />
        <path
          fill="#fff"
          d="M11.065 11.199l7.257-7.2c.137-.136.06-.41-.116-.41H14.3a.164.164 0 00-.117.051l-7.82 7.756c-.122.12-.302.013-.302-.179V3.82c0-.127-.083-.23-.185-.23H3.186c-.103 0-.186.103-.186.23V19.77c0 .128.083.23.186.23h2.69c.103 0 .186-.102.186-.23v-3.25c0-.069.025-.135.069-.178l2.424-2.406a.158.158 0 01.205-.023l6.484 4.772a7.677 7.677 0 003.453 1.283c.108.012.2-.095.2-.23v-3.06c0-.117-.07-.212-.164-.227a5.028 5.028 0 01-2.027-.807l-5.613-4.064c-.117-.078-.132-.279-.028-.381z"
        />
      </g>
    </svg>
  );
}
