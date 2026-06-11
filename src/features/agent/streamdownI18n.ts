import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { StreamdownTranslations } from "streamdown";

/**
 * Localized strings for streamdown's built-in chrome (code-block copy buttons,
 * table export menus, the external-link safety modal). Without this the
 * library falls back to its hardcoded English, breaking the i18n-everywhere
 * rule inside every assistant reply.
 */
export function useStreamdownTranslations(): Partial<StreamdownTranslations> {
  const { t, i18n } = useTranslation();
  return useMemo(
    () => ({
      close: t("agent.md.close"),
      copied: t("agent.md.copied"),
      copyCode: t("agent.md.copyCode"),
      copyLink: t("agent.md.copyLink"),
      copyTable: t("agent.md.copyTable"),
      copyTableAsCsv: t("agent.md.copyTableAsCsv"),
      copyTableAsMarkdown: t("agent.md.copyTableAsMarkdown"),
      copyTableAsTsv: t("agent.md.copyTableAsTsv"),
      downloadFile: t("agent.md.downloadFile"),
      downloadImage: t("agent.md.downloadImage"),
      downloadTable: t("agent.md.downloadTable"),
      downloadTableAsCsv: t("agent.md.downloadTableAsCsv"),
      downloadTableAsMarkdown: t("agent.md.downloadTableAsMarkdown"),
      downloadTableAsTsv: t("agent.md.downloadTableAsTsv"),
      exitFullscreen: t("agent.md.exitFullscreen"),
      externalLinkWarning: t("agent.md.externalLinkWarning"),
      imageNotAvailable: t("agent.md.imageNotAvailable"),
      openExternalLink: t("agent.md.openExternalLink"),
      openLink: t("agent.md.openLink"),
      tableFormatCsv: t("agent.md.tableFormatCsv"),
      tableFormatMarkdown: t("agent.md.tableFormatMarkdown"),
      tableFormatTsv: t("agent.md.tableFormatTsv"),
      viewFullscreen: t("agent.md.viewFullscreen"),
    }),
    // Re-memo when the locale flips; `t` identity covers it.
    [t, i18n.language],
  );
}
