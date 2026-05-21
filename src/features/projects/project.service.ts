import { CMD, invoke } from "@/lib/ipc";
import type { Project } from "./project.types";

export const projectsApi = {
  add(path: string): Promise<Project> {
    return invoke<Project>(CMD.addProject, { path });
  },
  remove(id: string): Promise<void> {
    return invoke<void>(CMD.removeProject, { id });
  },
  rename(id: string, name: string): Promise<Project> {
    return invoke<Project>(CMD.renameProject, { id, name });
  },
  updateMeta(id: string, patch: { color?: string; icon?: string }): Promise<Project> {
    return invoke<Project>(CMD.updateProjectMeta, {
      id,
      color: patch.color ?? null,
      icon: patch.icon ?? null,
    });
  },
  list(): Promise<Project[]> {
    return invoke<Project[]>(CMD.listProjects);
  },
  reorder(orderedIds: string[]): Promise<Project[]> {
    return invoke<Project[]>(CMD.reorderProjects, { orderedIds });
  },
  setActive(id: string): Promise<void> {
    return invoke<void>(CMD.setActiveProject, { id });
  },
  getActiveId(): Promise<string | null> {
    return invoke<string | null>(CMD.getActiveProjectId);
  },
};
