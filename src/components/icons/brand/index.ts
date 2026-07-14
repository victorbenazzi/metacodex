import type { ComponentType } from "react";

import { AntigravityIcon } from "./AntigravityIcon";
import { ClaudeCodeIcon } from "./ClaudeCodeIcon";
import { CodexIcon } from "./CodexIcon";
import { GrokIcon } from "./GrokIcon";
import { OpenCodeIcon } from "./OpenCodeIcon";
import { PiIcon } from "./PiIcon";
import type { BrandIconProps } from "./types";
import { XiaomiMiMoIcon } from "./XiaomiMiMoIcon";

export {
  AntigravityIcon,
  ClaudeCodeIcon,
  CodexIcon,
  GrokIcon,
  OpenCodeIcon,
  PiIcon,
  XiaomiMiMoIcon,
};
export type { BrandIconProps };

// Map keyed by CliTool.id (see src/features/terminal/cli-registry.ts) so any
// surface that renders a CLI (menu, palette, future agent picker) can resolve
// the right brand mark from a single source of truth.
export const CLI_BRAND_ICONS: Record<string, ComponentType<BrandIconProps>> = {
  "claude-code": ClaudeCodeIcon,
  "codex-cli": CodexIcon,
  opencode: OpenCodeIcon,
  grok: GrokIcon,
  "antigravity-cli": AntigravityIcon,
  "pi-cli": PiIcon,
  "mimo-code": XiaomiMiMoIcon,
};
