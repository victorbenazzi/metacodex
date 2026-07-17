import { useTranslation } from "react-i18next";
import { Trash2 } from "@/components/ui/icons";

import { DialogContent, DialogRoot } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useProjectsStore } from "@/features/projects/project.store";
import type { Project } from "@/features/projects/project.types";

interface RemoveProjectDialogProps {
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Confirm removing a project from the app (registry only, never touches disk).
 * Shared by both forms of the projects sidebar (rail + expanded) so the copy
 * and the destructive styling live in one place.
 */
export function RemoveProjectDialog({ project, open, onOpenChange }: RemoveProjectDialogProps) {
  const { t } = useTranslation();
  const remove = useProjectsStore((s) => s.remove);

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      {project && (
        <DialogContent
          title={t("projectRail.removeTitle")}
          description={t("projectRail.removeDescription")}
          width={420}
          footer={
            <>
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={async () => {
                  onOpenChange(false);
                  await remove(project.id);
                }}
                className="bg-danger text-on-primary hover:bg-danger/85"
              >
                <Icon icon={Trash2} size={12} className="text-on-primary" />
                {t("common.remove")}
              </Button>
            </>
          }
        >
          <div className="space-y-8px">
            <p className="text-ui text-body">
              <span className="font-medium text-ink">{project.name}</span>
              {t("projectRail.removeBodySuffix")}
            </p>
            <p className="font-mono text-label text-muted-soft">{project.path}</p>
          </div>
        </DialogContent>
      )}
    </DialogRoot>
  );
}
