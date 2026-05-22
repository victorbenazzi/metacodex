/**
 * Subtle paper texture used behind editorial empty states (WelcomeScreen,
 * ProjectEmptyState): two faint radial gradients + a low-opacity noise SVG.
 * Hairlines-and-grain only, no shadows. Purely decorative (`aria-hidden`).
 */
export function BackgroundGrain() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0"
      style={{
        background:
          "radial-gradient(900px 600px at 18% 12%, rgba(38,37,30,0.04), transparent 60%), radial-gradient(900px 600px at 82% 88%, rgba(38,37,30,0.025), transparent 60%)",
      }}
    >
      <svg className="h-full w-full opacity-[0.035]" xmlns="http://www.w3.org/2000/svg">
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
    </div>
  );
}
