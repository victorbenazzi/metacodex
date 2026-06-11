import { useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { BookOpen, Paperclip, Plug, Plus, RotateCw, Settings2 } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import {
  DropdownContent,
  DropdownItem,
  DropdownRoot,
  DropdownSeparator,
  DropdownSub,
  DropdownSubContent,
  DropdownSubTrigger,
  DropdownTrigger,
} from "@/components/ui/DropdownMenu";
import { cn } from "@/lib/cn";
import { useAgentChatStore } from "@/features/agent/chat.store";
import { useAgentComposerStore } from "@/features/agent/composer.store";
import { useAgentMcpStore } from "@/features/agent/mcp.store";
import { useAgentNavStore } from "@/features/agent/nav.store";
import { loadSkills, type SkillInfo } from "@/features/agent/skills";

/**
 * The Cursor-style "+" menu on the composer: attach a file/photo via the
 * native dialog, browse skills (selecting one inserts its `/name` token into
 * the prompt), and toggle MCP servers. Skills and the MCP registry load
 * lazily on first open.
 */
export function PlusMenu({
  onInsertToken,
}: {
  /** Insert a token (e.g. "/skill-name ") at the composer caret. */
  onInsertToken: (token: string) => void;
}) {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);

  return (
    <DropdownRoot
      onOpenChange={(open) => {
        if (open) {
          if (skills === null) void loadSkills().then(setSkills);
          if (!useAgentMcpStore.getState().loaded) void useAgentMcpStore.getState().load();
        }
      }}
    >
      <DropdownTrigger asChild>
        <button
          type="button"
          aria-label={t("agent.composer.attach")}
          className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-pill border border-hairline text-muted hover:bg-surface-strong/60 hover:text-ink data-[state=open]:bg-surface-strong/60 data-[state=open]:text-ink"
        >
          <Icon icon={Plus} size={16} strokeWidth={2} />
        </button>
      </DropdownTrigger>
      <DropdownContent align="start" sideOffset={8}>
        <DropdownItem
          onSelect={() => {
            void openDialog({ multiple: true }).then((picked) => {
              if (!picked) return;
              const paths = Array.isArray(picked) ? picked : [picked];
              useAgentComposerStore.getState().addPaths(paths);
            });
          }}
        >
          <Icon icon={Paperclip} size={14} className="text-muted" />
          {t("agent.composer.attachFileOrPhoto")}
        </DropdownItem>

        <DropdownSub>
          <DropdownSubTrigger>
            <Icon icon={BookOpen} size={14} className="text-muted" />
            {t("agent.composer.skills")}
          </DropdownSubTrigger>
          <DropdownSubContent className="max-h-[320px] max-w-[300px] overflow-y-auto">
            {skills === null || skills.length === 0 ? (
              <div className="px-[10px] py-[8px] text-caption text-muted">
                {skills === null ? t("agent.skills.loading") : t("agent.composer.skillsEmpty")}
              </div>
            ) : (
              skills.map((s) => (
                <DropdownItem key={s.path} onSelect={() => onInsertToken(`/${s.name} `)}>
                  <span className="flex min-w-0 flex-col items-start gap-[1px]">
                    <span className="text-ink">{s.name}</span>
                    {s.description ? (
                      <span className="max-w-[240px] truncate text-label text-muted">
                        {s.description}
                      </span>
                    ) : null}
                  </span>
                </DropdownItem>
              ))
            )}
          </DropdownSubContent>
        </DropdownSub>

        <McpSubmenu />
      </DropdownContent>
    </DropdownRoot>
  );
}

function McpSubmenu() {
  const { t } = useTranslation();
  const entries = useAgentMcpStore((s) => s.entries);
  const status = useAgentMcpStore((s) => s.status);
  const pendingRestart = useAgentMcpStore((s) => s.pendingRestart);
  const restarting = useAgentMcpStore((s) => s.restarting);
  const setEnabled = useAgentMcpStore((s) => s.setEnabled);
  const restart = useAgentMcpStore((s) => s.restart);
  const openCustomize = useAgentNavStore((s) => s.openCustomize);
  const streaming = useAgentChatStore((s) => s.status !== "idle");
  const loadError = useAgentMcpStore((s) => s.error);

  return (
    <DropdownSub>
      <DropdownSubTrigger>
        <Icon icon={Plug} size={14} className="text-muted" />
        {t("agent.composer.mcpServers")}
        {pendingRestart ? (
          <span className="ml-auto inline-block h-[6px] w-[6px] rounded-pill bg-warn" />
        ) : null}
      </DropdownSubTrigger>
      <DropdownSubContent className="max-w-[280px]">
        {entries.length === 0 ? (
          <div className="px-[10px] py-[8px] text-caption text-muted">
            {loadError ?? t("agent.composer.mcpEmpty")}
          </div>
        ) : (
          entries.map((e) => (
            <DropdownItem
              key={e.id}
              keepOpenOnSelect
              onSelect={() => void setEnabled(e.id, !e.enabled)}
              trailing={<McpDot enabled={e.enabled} live={status?.[e.name]} />}
            >
              <span className={e.enabled ? "text-ink" : "text-muted"}>{e.name}</span>
            </DropdownItem>
          ))
        )}
        {pendingRestart ? (
          <>
            <DropdownSeparator />
            <DropdownItem
              disabled={restarting || streaming}
              onSelect={() => void restart()}
            >
              <Icon icon={RotateCw} size={13} className={cn("text-warn", restarting && "animate-spin")} />
              <span className="text-warn">{t("agent.composer.mcpRestartToApply")}</span>
            </DropdownItem>
          </>
        ) : null}
        <DropdownSeparator />
        <DropdownItem onSelect={() => openCustomize("mcp")}>
          <Icon icon={Settings2} size={13} className="text-muted" />
          {t("agent.composer.mcpSettings")}
        </DropdownItem>
      </DropdownSubContent>
    </DropdownSub>
  );
}

/** Enabled is a config fact; the dot color is the LIVE status: green only when
 *  the sidecar reports the server connected, red on error, grey otherwise.
 *  Toggling alone never paints green (the change lands after a restart). */
function McpDot({
  enabled,
  live,
}: {
  enabled: boolean;
  live?: { status?: string; error?: string };
}) {
  const ok = live?.status === "connected" || live?.status === "ok" || live?.status === "ready";
  const failed = !!live?.error || live?.status === "failed" || live?.status === "error";
  return (
    <span
      title={live?.error}
      className={cn(
        "inline-block h-[7px] w-[7px] rounded-pill",
        !enabled ? "bg-muted-soft" : failed ? "bg-danger" : ok ? "bg-success" : "bg-warn",
      )}
    />
  );
}
