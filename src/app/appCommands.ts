import type { PreviewGrant } from "@/lib/events";

export interface AppCommands {
  newTerminal: () => void;
  openFolder: () => void;
  cloneFromGithub: () => void;
  closeActiveTab: () => void;
  switchProject: (n: number) => void;
  openFile: (path: string, name: string, openInEditMode?: boolean) => void;
  pickPreviewFile: () => void | Promise<void>;
  sendToProject: (file: PreviewGrant) => void | Promise<void>;
  sendToTerminal: (text: string) => void;
  jumpToNextAttention: () => void;
  renameActiveTab: () => void;
  moveActiveTab: (delta: -1 | 1) => void;
  activateAdjacentTab: (delta: -1 | 1) => void;
}

let currentCommands: AppCommands | null = null;

export function registerAppCommands(commands: AppCommands): () => void {
  currentCommands = commands;
  return () => {
    if (currentCommands === commands) currentCommands = null;
  };
}

export function getAppCommands(): AppCommands | null {
  return currentCommands;
}
