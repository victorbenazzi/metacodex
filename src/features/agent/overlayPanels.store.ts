import { create } from "zustand";

/**
 * Ephemeral UI state for the inspect drawers that dock over the Agent View:
 * file tree on the left, Source Control (git diff) on the right. They are
 * ports of the Code view panels (same components, same persisted widths), with
 * separate open state so toggling them in Agent mode never disturbs the Code
 * layout underneath. Memory-only: both start closed on each launch, matching
 * the Code view's Source Control panel policy. Toggled from the title bar.
 */
interface AgentOverlayPanelsState {
  explorerOpen: boolean;
  gitOpen: boolean;
  toggleExplorer: () => void;
  toggleGit: () => void;
}

export const useAgentOverlayPanelsStore = create<AgentOverlayPanelsState>((set) => ({
  explorerOpen: false,
  gitOpen: false,
  toggleExplorer: () => set((s) => ({ explorerOpen: !s.explorerOpen })),
  toggleGit: () => set((s) => ({ gitOpen: !s.gitOpen })),
}));
