import type { ComponentType } from "react";
import type { IconType } from "@lobehub/icons";
import AntigravityColor from "@lobehub/icons/es/Antigravity/components/Color";
import ClaudeCodeColor from "@lobehub/icons/es/ClaudeCode/components/Color";
import CodexColor from "@lobehub/icons/es/Codex/components/Color";
import GrokMono from "@lobehub/icons/es/Grok/components/Mono";
import KimiColor from "@lobehub/icons/es/Kimi/components/Color";
import OpenCodeMono from "@lobehub/icons/es/OpenCode/components/Mono";
import PiMono from "@lobehub/icons/es/Pi/components/Mono";
import XiaomiMiMoMono from "@lobehub/icons/es/XiaomiMiMo/components/Mono";

import { cn } from "@/lib/cn";

import { MetacodexMark } from "./MetacodexMark";
import type { BrandIconProps } from "./types";

export { MetacodexMark };
export type { BrandIconProps };

/**
 * Lobe Color/Mono SVGs only. The compounded exports (Avatar, Combine)
 * pull `@lobehub/ui` and antd, which this app does not ship.
 */
function lobe(Icon: IconType): ComponentType<BrandIconProps> {
  return function LobeBrand({ size = 16, className }: BrandIconProps) {
    return <Icon size={size} className={className} aria-hidden />;
  };
}

/** Kimi's Color mark is a white swoosh. Sit it on the brand black ground. */
function KimiIcon({ size = 16, className }: BrandIconProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-xs bg-[var(--brand-black)]",
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <KimiColor size={Math.round(size * 0.6)} />
    </span>
  );
}

export const CLI_BRAND_ICONS: Record<string, ComponentType<BrandIconProps>> = {
  mcx: MetacodexMark,
  "claude-code": lobe(ClaudeCodeColor),
  "codex-cli": lobe(CodexColor),
  opencode: lobe(OpenCodeMono),
  grok: lobe(GrokMono),
  "kimi-code": KimiIcon,
  "antigravity-cli": lobe(AntigravityColor),
  "pi-cli": lobe(PiMono),
  "mimo-code": lobe(XiaomiMiMoMono),
};
