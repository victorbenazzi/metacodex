import i18n from "@/features/i18n/config";
import { toast } from "@/features/ui/toast.store";

import { gitApi } from "./git.service";
import { useGitStore } from "./git.store";
import { useChangesUiStore } from "./changes.store";

function errMsg(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

async function afterMutation(projectId: string, root: string): Promise<void> {
  await useGitStore.getState().refresh(projectId, root, true);
}

export const gitActions = {
  async commit(projectId: string, root: string, message: string, paths: string[]): Promise<boolean> {
    const ui = useChangesUiStore.getState();
    if (ui.busy) return false;
    ui.setBusy(true);
    try {
      await gitApi.commit(root, message, paths);
      ui.setMessage(projectId, "");
      await afterMutation(projectId, root);
      return true;
    } catch (err) {
      toast.error(i18n.t("sourceControl.commitFailed"), errMsg(err));
      return false;
    } finally {
      useChangesUiStore.getState().setBusy(false);
    }
  },

  async discard(projectId: string, root: string, paths: string[]): Promise<boolean> {
    const ui = useChangesUiStore.getState();
    if (ui.busy) return false;
    ui.setBusy(true);
    try {
      await gitApi.discard(root, paths);
      await afterMutation(projectId, root);
      return true;
    } catch (err) {
      toast.error(i18n.t("sourceControl.discardFailed"), errMsg(err));
      return false;
    } finally {
      useChangesUiStore.getState().setBusy(false);
    }
  },

  async createBranch(projectId: string, root: string, name: string): Promise<boolean> {
    const ui = useChangesUiStore.getState();
    if (ui.busy) return false;
    ui.setBusy(true);
    try {
      await gitApi.createBranch(root, name);
      await afterMutation(projectId, root);
      return true;
    } catch (err) {
      toast.error(i18n.t("sourceControl.branchFailed"), errMsg(err));
      return false;
    } finally {
      useChangesUiStore.getState().setBusy(false);
    }
  },

  async push(projectId: string, root: string): Promise<boolean> {
    const ui = useChangesUiStore.getState();
    if (ui.busy) return false;
    ui.setBusy(true);
    try {
      await gitApi.push(root);
      await afterMutation(projectId, root);
      return true;
    } catch (err) {
      toast.error(i18n.t("sourceControl.pushFailed"), errMsg(err));
      return false;
    } finally {
      useChangesUiStore.getState().setBusy(false);
    }
  },
};
