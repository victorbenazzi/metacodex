import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";
import { DialogContent, DialogRoot } from "@/components/ui/Dialog";
import type { QuitBlockedPayload } from "@/lib/events";

const AREA_KEYS: Record<string, string> = {
  editors: "quitBlocked.area.editors",
  settings: "quitBlocked.area.settings",
  workspaces: "quitBlocked.area.workspaces",
  resume: "quitBlocked.area.resume",
  diagnostics: "quitBlocked.area.diagnostics",
  clones: "quitBlocked.area.clones",
  terminals: "quitBlocked.area.terminals",
  watchers: "quitBlocked.area.watchers",
  quit: "quitBlocked.area.quit",
};

const REASON_KEYS: Record<string, string> = {
  flush_timeout: "quitBlocked.reason.flushTimeout",
  flush_failed: "quitBlocked.reason.flushFailed",
  save_failed: "quitBlocked.reason.saveFailed",
  join_failed: "quitBlocked.reason.cleanupFailed",
  cleanup_failed: "quitBlocked.reason.cleanupFailed",
};

interface QuitBlockedDialogProps {
  blocked: QuitBlockedPayload | null;
  onRetry: (token: string) => void;
  onForceQuit: (token: string) => void;
}

export function QuitBlockedDialog({
  blocked,
  onRetry,
  onForceQuit,
}: QuitBlockedDialogProps) {
  const { t } = useTranslation();
  return (
    <DialogRoot open={blocked !== null} onOpenChange={() => undefined}>
      <DialogContent
        title={t("quitBlocked.title")}
        description={t("quitBlocked.description")}
        width={460}
        footer={blocked ? (
          <>
            <Button variant="outline" size="sm" onClick={() => onRetry(blocked.token)}>
              {t("common.retry")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="bg-danger text-on-primary hover:bg-danger/85 focus-visible:outline-danger"
              onClick={() => onForceQuit(blocked.token)}
            >
              {t("quitBlocked.forceQuit")}
            </Button>
          </>
        ) : null}
      >
        {blocked ? (
          <div className="space-y-12px">
            <ul className="space-y-8px">
              {blocked.failures.map((failure, index) => (
                <li
                  key={`${failure.area}:${failure.code}:${index}`}
                  className="rounded-sm border border-hairline-soft bg-surface-soft px-12px py-10px"
                >
                  <p className="text-ui font-medium text-ink">
                    {t(AREA_KEYS[failure.area] ?? "quitBlocked.area.unknown")}
                  </p>
                  <p className="mt-2px text-caption text-muted">
                    {t(REASON_KEYS[failure.code] ?? "quitBlocked.reason.unknown")}
                  </p>
                </li>
              ))}
            </ul>
            <p className="text-caption text-danger">{t("quitBlocked.warning")}</p>
          </div>
        ) : null}
      </DialogContent>
    </DialogRoot>
  );
}
