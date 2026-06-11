import { create } from "zustand";

/** Which surface the Agent View main area shows. `chat` covers both the hero
 *  (empty) and an active thread. `customize` hosts the lateral-tab page with
 *  Skills, MCP Servers and Tools. `agents` is the agent-entities page (list,
 *  or one agent's profile when `profileAgentId` is set). */
export type AgentSection = "chat" | "scheduled" | "customize" | "agents";

/** Lateral tabs inside the Customize page. */
export type CustomizeTab = "skills" | "mcp" | "tools" | "permissions";

interface AgentNavState {
  section: AgentSection;
  customizeTab: CustomizeTab;
  /** Agent entity whose profile the Agents page shows; null = the list. */
  profileAgentId: string | null;
  setSection: (section: AgentSection) => void;
  /** Jump straight to the Customize page, optionally on a specific tab
   *  (used by deep links like the composer's "MCP settings"). */
  openCustomize: (tab?: CustomizeTab) => void;
  /** Open the Agents page, optionally straight onto one agent's profile. */
  openAgents: (profileAgentId?: string | null) => void;
}

export const useAgentNavStore = create<AgentNavState>((set) => ({
  section: "chat",
  customizeTab: "skills",
  profileAgentId: null,
  setSection: (section) => set({ section }),
  openCustomize: (tab) =>
    set((s) => ({ section: "customize", customizeTab: tab ?? s.customizeTab })),
  openAgents: (profileAgentId = null) => set({ section: "agents", profileAgentId }),
}));
