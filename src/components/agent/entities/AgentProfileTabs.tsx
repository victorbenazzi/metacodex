/**
 * Lateral sections of an agent profile (phases 2-4 of AGENTS_DESIGN.md).
 * Thin orchestrator: each section lives in its own file (same precedent as
 * CustomizePanel importing SkillsSection/McpSection); this module is the
 * single import point AgentsPanel consumes.
 */
export { MemorySection } from "./MemorySection";
export { ActivitySection } from "./ActivitySection";
export { ProposalsSection } from "./ProposalsSection";
export { AgendaSection } from "./AgendaSection";
