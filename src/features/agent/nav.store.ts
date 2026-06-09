import { create } from "zustand";

/** Which surface the Agent View main area shows. `chat` covers both the hero
 *  (empty) and an active thread. */
export type AgentSection = "chat" | "skills" | "scheduled" | "webbridge";

interface AgentNavState {
  section: AgentSection;
  setSection: (section: AgentSection) => void;
}

export const useAgentNavStore = create<AgentNavState>((set) => ({
  section: "chat",
  setSection: (section) => set({ section }),
}));
