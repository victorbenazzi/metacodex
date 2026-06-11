import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, FolderClosed } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import {
  DropdownContent,
  DropdownItem,
  DropdownRoot,
  DropdownSeparator,
  DropdownTrigger,
} from "@/components/ui/DropdownMenu";
import { useAgentChatStore } from "@/features/agent/chat.store";
import { useProjectsStore } from "@/features/projects/project.store";
import { tileIconColor } from "@/features/projects/color";
import { useThemeStore } from "@/features/theme/theme.store";

import { CreateProjectDialog } from "./CreateProjectDialog";
import { ProjectActionItems } from "./ProjectActions";

/**
 * Scopes the agent to a metacodex project root. Rendered as the quiet meta line
 * under the composer (folder glyph + name + chevron). The menu leads with the
 * three ways to start (create / use existing / no folder), then lists existing
 * projects to switch between. The chosen path rides every opencode call as
 * `?directory=`, without it the agent runs in the sidecar's launch cwd.
 */
export function ProjectPicker() {
  const { t } = useTranslation();
  const projects = useProjectsStore((s) => s.projects);
  const directory = useAgentChatStore((s) => s.directory);
  const setDirectory = useAgentChatStore((s) => s.setDirectory);
  const theme = useThemeStore((s) => s.effective);

  const [createOpen, setCreateOpen] = useState(false);

  const active = projects.find((p) => p.path === directory) ?? null;

  return (
    <>
      <DropdownRoot>
        <DropdownTrigger asChild>
          <button
            type="button"
            aria-label={t("agent.composer.projectLabel")}
            className="inline-flex max-w-[340px] items-center gap-[6px] rounded-sm py-[2px] pl-[2px] pr-[4px] text-caption text-muted outline-none transition-colors hover:text-body data-[state=open]:text-body focus-visible:ring-2 focus-visible:ring-ink/15"
          >
            <Icon icon={FolderClosed} size={14} strokeWidth={2} className="shrink-0" />
            <span className="truncate">
              {active ? active.name : t("agent.composer.workInProject")}
            </span>
            <Icon icon={ChevronDown} size={13} strokeWidth={2} className="shrink-0" />
          </button>
        </DropdownTrigger>
        <DropdownContent align="start" className="max-h-[360px] min-w-[248px] overflow-y-auto">
          <ProjectActionItems onStartScratch={() => setCreateOpen(true)} />
          {projects.length > 0 ? <DropdownSeparator /> : null}
          {projects.map((p) => {
            const isActive = p.path === directory;
            return (
              <DropdownItem
                key={p.id}
                onSelect={() => void setDirectory(p.path)}
                trailing={isActive ? <Icon icon={Check} size={13} className="text-ink" /> : null}
              >
                <span
                  className="h-[8px] w-[8px] shrink-0 rounded-pill"
                  style={{ backgroundColor: tileIconColor(p.color, theme) }}
                />
                <span className={isActive ? "text-ink" : undefined}>{p.name}</span>
              </DropdownItem>
            );
          })}
        </DropdownContent>
      </DropdownRoot>

      <CreateProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(p) => void setDirectory(p.path)}
      />
    </>
  );
}
