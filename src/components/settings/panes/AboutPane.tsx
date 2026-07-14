import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  Download,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";

import { Icon } from "@/components/ui/Icon";
import { PaneHeader } from "@/components/settings/SettingsPrimitives";
import { CMD, invoke } from "@/lib/ipc";
import { isMac, isWindows } from "@/lib/platform";
import { useUpdatesStore } from "@/features/updates/updates.store";
import {
  checkForUpdatesManual,
  startInstall,
} from "@/features/updates/updates.service";

export function AboutPane() {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<"up-to-date" | "dev" | null>(null);
  const updateStatus = useUpdatesStore((s) => s.status);

  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch(() => {
        if (!cancelled) setVersion(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isChecking = updateStatus.kind === "checking";
  const isAvailable = updateStatus.kind === "available";
  const isBusy =
    updateStatus.kind === "downloading" || updateStatus.kind === "installing";
  const isError = updateStatus.kind === "error";

  const handleCheck = async () => {
    setLastResult(null);
    const result = await checkForUpdatesManual();
    if (result.kind === "up-to-date") setLastResult("up-to-date");
    else if (result.kind === "dev") setLastResult("dev");
  };

  const handleInstall = () => {
    void startInstall();
  };

  const openAuthorSite = () => {
    invoke(CMD.openExternalUrl, {
      url: "https://www.victorbenazzi.com.br/?utm_source=metacodex&utm_medium=app&utm_campaign=about",
    }).catch((err) => console.warn("[open_external_url] failed", err));
  };

  return (
    <div>
      <PaneHeader title={t("settings.about.title")} />
      <h1
        className="font-display text-display font-medium text-ink"
        style={{ lineHeight: 1.05 }}
      >
        metacodex
      </h1>
      <p className="mt-[10px] font-display text-title leading-[1.5] text-body">
        {t("settings.about.tagline")}
      </p>
      <ul className="mt-[20px] flex flex-col gap-[6px]">
        <li className="font-mono text-label text-muted">
          {t("settings.about.version")}{" "}
          <span className="text-ink">{version ?? "…"}</span>
        </li>
        <li className="font-mono text-label text-muted">
          {t("settings.about.platform")}{" "}
          <span className="text-ink">{isMac ? "macOS" : isWindows ? "Windows" : "Linux"}</span>
        </li>
        <li className="font-mono text-label text-muted">
          {t("settings.about.stack")}{" "}
          <span className="text-ink">
            Tauri 2 · React 19 · CodeMirror 6 · xterm.js · portable-pty
          </span>
        </li>
      </ul>

      <div className="mt-[18px] flex flex-wrap items-center gap-[10px]">
        {isAvailable ? (
          <button
            type="button"
            onClick={handleInstall}
            className="inline-flex items-center gap-[6px] rounded-sm border border-update-blue-strong bg-update-blue-strong px-[10px] py-[5px] font-mono text-label leading-none text-on-update transition duration-fast hover:brightness-110"
            title={t("updates.pill.available", { version: updateStatus.version })}
          >
            <Icon icon={Download} size={10} />
            <span>{t("updates.pill.available", { version: updateStatus.version })}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleCheck}
            disabled={isChecking || isBusy}
            className="inline-flex items-center gap-[6px] rounded-sm border border-hairline-strong px-[10px] py-[5px] font-mono text-label leading-none text-ink transition-colors duration-fast hover:bg-surface-strong/45 disabled:cursor-default disabled:opacity-40"
          >
            <Icon
              icon={isChecking ? Loader2 : RefreshCw}
              size={10}
              className={isChecking ? "animate-spin motion-reduce:animate-none" : undefined}
            />
            <span>
              {isChecking
                ? t("settings.about.checking")
                : t("settings.about.checkForUpdates")}
            </span>
          </button>
        )}

        {!isChecking && !isAvailable && lastResult === "up-to-date" && (
          <span className="inline-flex items-center gap-[4px] font-mono text-label text-success">
            <Icon icon={CheckCircle2} size={10} />
            {t("settings.about.upToDate")}
          </span>
        )}
        {!isChecking && lastResult === "dev" && (
          <span className="font-mono text-label text-muted">
            {t("settings.about.devNoUpdates")}
          </span>
        )}
        {!isChecking && !isAvailable && isError && (
          <span
            className="inline-flex items-center gap-[4px] font-mono text-label text-warn"
            title={updateStatus.message}
          >
            <Icon icon={CircleAlert} size={10} />
            {t("settings.about.checkFailed")}
          </span>
        )}
      </div>

      <p className="mt-[18px] font-mono text-label text-muted">
        {t("settings.about.author")}{" "}
        <button
          type="button"
          onClick={openAuthorSite}
          title="victorbenazzi.com.br"
          className="group inline-flex items-center gap-[3px] rounded-xs text-ink transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[2px]"
        >
          <span className="underline decoration-1 decoration-hairline underline-offset-[3px] transition-colors duration-fast group-hover:decoration-muted">
            Victor Benazzi
          </span>
          <Icon
            icon={ArrowUpRight}
            size={10}
            className="opacity-60"
          />
        </button>
      </p>
    </div>
  );
}
