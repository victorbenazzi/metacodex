import { CMD, invoke } from "@/lib/ipc";
import type {
  RemoteAccess,
  RemoteAccessDraft,
  RemoteAccessTestResult,
  RemoteProjectCandidate,
} from "./remote-access.types";

export const remoteAccessApi = {
  list(): Promise<RemoteAccess[]> {
    return invoke<RemoteAccess[]>(CMD.remoteAccessList);
  },
  save(draft: RemoteAccessDraft): Promise<RemoteAccess> {
    return invoke<RemoteAccess>(CMD.remoteAccessSave, { draft });
  },
  remove(id: string): Promise<void> {
    return invoke<void>(CMD.remoteAccessRemove, { id });
  },
  test(draft: RemoteAccessDraft, trustHost: boolean): Promise<RemoteAccessTestResult> {
    return invoke<RemoteAccessTestResult>(CMD.remoteAccessTest, { draft, trustHost });
  },
  discoverProjects(accessId: string): Promise<RemoteProjectCandidate[]> {
    return invoke<RemoteProjectCandidate[]>(CMD.remoteDiscoverProjects, { accessId });
  },
};
