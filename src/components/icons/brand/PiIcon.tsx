import type { BrandIconProps } from "./types";

export function PiIcon({ size = 16, className }: BrandIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      // Tight crop on the artwork bounds (mark spans 165–635 in the original
      // 800-unit viewBox) so the visible mark fills the requested size box —
      // visual mass matches the other CLI brand icons.
      viewBox="165 165 470 470"
      className={className}
      aria-hidden
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
      />
      <path fill="currentColor" d="M517.36 400H634.72V634.72H517.36Z" />
    </svg>
  );
}
