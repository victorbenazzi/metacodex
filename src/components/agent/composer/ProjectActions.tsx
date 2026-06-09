import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Check, FolderSearch, FolderX, Plus } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { DropdownItem } from "@/components/ui/DropdownMenu";
import { useAgentChatStore } from "@/features/agent/chat.store";
import { useProjectsStore } from "@/features/projects/project.store";

/**
 * Project scoping actions shared by the composer's picker and the sidebar
 * section: register an existing folder, or scope to no folder. Keeps the native
 * folder-dialog flow in one place instead of duplicated across both surfaces.
 */
export function useProjectActions() {
  const { t } = useTranslation();
  const addProject = useProjectsStore((s) => s.add);
  const setDirectory = useAgentChatStore((s) => s.setDirectory);

  const useExistingFolder = useCallback(async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: t("agent.createProject.dirDialogTitle"),
      });
      if (typeof selected !== "string" || selected.length === 0) return;
      const project = await addProject(selected);
      void setDirectory(project.path);
    } catch (e) {
      console.error("[project-actions] use existing folder failed", e);
    }
  }, [addProject, setDirectory, t]);

  return { useExistingFolder, setDirectory };
}

/**
 * The three "how to start" dropdown items (create new / use existing / no
 * folder). The consumer owns the create dialog and passes `onStartScratch` to
 * open it; the other two act immediately.
 */
export function ProjectActionItems({ onStartScratch }: { onStartScratch: () => void }) {
  const { t } = useTranslation();
  const { useExistingFolder, setDirectory } = useProjectActions();
  const directory = useAgentChatStore((s) => s.directory);

  return (
    <>
      <DropdownItem onSelect={onStartScratch}>
        <Icon icon={Plus} size={15} strokeWidth={2} className="text-muted" />
        {t("agent.project.startScratch")}
      </DropdownItem>
      <DropdownItem onSelect={() => void useExistingFolder()}>
        <Icon icon={FolderSearch} size={15} strokeWidth={2} className="text-muted" />
        {t("agent.project.useExisting")}
      </DropdownItem>
      <DropdownItem
        onSelect={() => void setDirectory(null)}
        trailing={
          directory === null ? <Icon icon={Check} size={13} className="text-ink" /> : null
        }
      >
        <Icon icon={FolderX} size={15} strokeWidth={2} className="text-muted" />
        {t("agent.project.noFolder")}
      </DropdownItem>
    </>
  );
}
