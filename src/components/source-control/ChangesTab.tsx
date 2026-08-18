import { ChangesView } from "@/components/source-control/ChangesView";
import { useProjectsStore } from "@/features/projects/project.store";
import { useSidePanelStore } from "@/features/side-panel/sidePanel.store";
import { openFileInProject } from "@/features/tabs";

interface ChangesTabProps {
  projectId: string;
}

export function ChangesTab({ projectId }: ChangesTabProps) {
  const project = useProjectsStore(
    (s) => s.projects.find((p) => p.id === projectId) ?? null,
  );
  if (!project) return null;
  return (
    <ChangesView
      projectId={project.id}
      projectPath={project.path}
      variant="page"
      onOpenFile={(path, name) => {
        const id = openFileInProject(project, path, name);
        useSidePanelStore.getState().focusDoc(id);
      }}
    />
  );
}
