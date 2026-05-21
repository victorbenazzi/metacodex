import { ArrowUpRight, FolderOpen, TerminalSquare } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { Kbd } from "@/components/ui/Kbd";
import { cn } from "@/lib/cn";

interface WelcomeScreenProps {
  onOpenFolder: () => void;
  onOpenTerminal: () => void;
}

/**
 * Editorial empty state. Strong typographic hierarchy:
 *   - Fraunces display for "metacodex"
 *   - Inter for body
 *   - Mono for the metadata strip
 * Hairlines only, no shadows, lots of negative space.
 */
export function WelcomeScreen({ onOpenFolder, onOpenTerminal }: WelcomeScreenProps) {
  return (
    <div className="relative flex h-full w-full overflow-hidden bg-canvas">
      <BackgroundGrain />

      <div className="relative z-10 mx-auto flex w-full max-w-[760px] flex-col px-[40px] pt-[88px]">
        <span className="editorial-caps">Welcome</span>

        <div className="mt-[18px] flex items-center gap-[20px]">
          <img
            src="/black-metacodex-icon.png"
            alt=""
            draggable={false}
            className="select-none dark:hidden"
            style={{
              width: "clamp(48px, 6vw, 76px)",
              height: "clamp(48px, 6vw, 76px)",
            }}
          />
          <img
            src="/white-metacodex-icon.png"
            alt=""
            draggable={false}
            className="hidden select-none dark:block"
            style={{
              width: "clamp(48px, 6vw, 76px)",
              height: "clamp(48px, 6vw, 76px)",
            }}
          />
          <h1
            className="font-display tracking-[-0.02em] text-ink"
            style={{ fontSize: "clamp(56px, 7vw, 88px)", lineHeight: 1.02, fontWeight: 500 }}
          >
            metacodex
          </h1>
        </div>

        <p className="mt-[12px] max-w-[520px] font-display text-[18px] italic leading-[1.5] text-body">
          A quiet, local-first workspace for code &mdash; with a real native terminal and your favourite AI
          coding CLIs one keystroke away.
        </p>

        <div className="mt-[36px] flex items-center gap-[10px]">
          <PrimaryAction onClick={onOpenFolder}>
            <Icon icon={FolderOpen} size={14} className="text-on-primary" />
            <span>Open folder</span>
            <Kbd keys={["Mod", "O"]} className="ml-[6px] text-on-primary/70" />
          </PrimaryAction>

          <SecondaryAction onClick={onOpenTerminal}>
            <Icon icon={TerminalSquare} size={14} />
            <span>Open terminal</span>
            <Kbd keys={["Mod", "T"]} className="ml-[6px]" />
          </SecondaryAction>
        </div>

        <div className="mt-[64px] grid max-w-[640px] grid-cols-3 gap-[1px] overflow-hidden rounded-sm border border-hairline bg-hairline">
          <PrincipleCard label="Local first" body="Projects stay on disk. metacodex only stores workspace metadata." />
          <PrincipleCard label="Real PTY" body="Same shell as Terminal.app — Claude Code, Codex, OpenCode, Antigravity." />
          <PrincipleCard label="Editorial calm" body="Hairlines, warm canvas, no shadows. Reads like a refined print spread." />
        </div>

        <FooterMeta />
      </div>
    </div>
  );
}

function PrimaryAction({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-[36px] items-center gap-[8px] rounded-sm bg-ink px-[16px] text-[13px] font-medium text-on-primary",
        "transition-colors duration-150 hover:bg-primary-active focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[3px]",
      )}
    >
      {children}
    </button>
  );
}

function SecondaryAction({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-[36px] items-center gap-[8px] rounded-sm border border-hairline-strong bg-canvas px-[16px] text-[13px] font-medium text-ink",
        "transition-colors duration-150 hover:bg-surface-strong/40",
      )}
    >
      {children}
    </button>
  );
}

function PrincipleCard({ label, body }: { label: string; body: string }) {
  return (
    <article className="bg-canvas-soft px-[18px] py-[20px]">
      <header className="editorial-caps text-muted-soft">{label}</header>
      <p className="mt-[10px] text-[13px] leading-[1.55] text-body">{body}</p>
    </article>
  );
}

function FooterMeta() {
  return (
    <footer className="mt-auto flex flex-wrap items-center gap-x-[14px] gap-y-[4px] pb-[28px] pt-[40px] font-mono text-[11px] text-muted-soft">
      <span>v0.0.1</span>
      <span aria-hidden>·</span>
      <span>{getPlatformLabel()}</span>
      <span aria-hidden>·</span>
      <span className="inline-flex items-center gap-[4px]">
        anthropic · openai · sst · google
        <Icon icon={ArrowUpRight} size={10} className="opacity-60" />
      </span>
    </footer>
  );
}

function getPlatformLabel(): string {
  if (typeof navigator === "undefined") return "desktop";
  if (/Mac/.test(navigator.userAgent)) return "macOS";
  if (/Win/.test(navigator.userAgent)) return "Windows";
  if (/Linux/.test(navigator.userAgent)) return "Linux";
  return "desktop";
}

function BackgroundGrain() {
  // Subtle paper texture via two radial gradients + tiny noise SVG.
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
