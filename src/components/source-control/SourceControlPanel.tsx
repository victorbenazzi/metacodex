import { ChangesView } from "./ChangesView";

interface SourceControlPanelProps {
  projectId: string;
  projectPath: string;
  onOpenFile?: (path: string, name: string) => void;
  onOpenChanges?: (expandPath?: string) => void;
  onOpenInTerminal?: (cwd: string, name: string) => void;
}

export function SourceControlPanel({
  projectId,
  projectPath,
  onOpenFile,
  onOpenChanges,
  onOpenInTerminal,
}: SourceControlPanelProps) {
  return (
    <ChangesView
      projectId={projectId}
      projectPath={projectPath}
      variant="panel"
      onOpenFile={onOpenFile}
      onOpenChanges={onOpenChanges}
      onOpenInTerminal={onOpenInTerminal}
    />
  );
}
