import { create } from "zustand";

/** Which surface the Agent View main area shows. `chat` covers both the hero
 *  (empty) and an active thread. `customize` hosts the lateral-tab page with
 *  Skills, MCP Servers and Tools. */
export type AgentSection = "chat" | "scheduled" | "customize";

/** Lateral tabs inside the Customize page. */
export type CustomizeTab = "skills" | "mcp" | "tools" | "permissions";

interface AgentNavState {
  section: AgentSection;
  customizeTab: CustomizeTab;
  setSection: (section: AgentSection) => void;
  /** Jump straight to the Customize page, optionally on a specific tab
   *  (used by deep links like the composer's "MCP settings"). */
  openCustomize: (tab?: CustomizeTab) => void;
}

export const useAgentNavStore = create<AgentNavState>((set) => ({
  section: "chat",
  customizeTab: "skills",
  setSection: (section) => set({ section }),
  openCustomize: (tab) =>
    set((s) => ({ section: "customize", customizeTab: tab ?? s.customizeTab })),
}));
