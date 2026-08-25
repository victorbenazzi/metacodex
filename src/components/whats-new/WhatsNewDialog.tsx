import { useEffect } from "react";
import * as RD from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";

import { ArrowUpRight, X } from "@/components/ui/icons";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { CMD, invoke } from "@/lib/ipc";
import { useWhatsNewStore } from "@/features/whats-new/whatsNew.store";
import { githubReleaseUrl } from "@/features/whats-new/changelog";
import heroImage from "@/assets/changelog/bg-changelog-1.webp";
import milestoneHeroImage from "@/assets/changelog/bg-changelog-v1.webp";
import appIcon from "@/assets/brand/app-icon.png";

/**
 * Post-update changelog: shows once after the app boots into a version newer
 * than the last one the user saw (see whatsNew.store for the trigger rules),
 * plus on demand from Settings > About. Hero artwork is fixed dark imagery,
 * so the controls over it use the absolute `media-*` tokens, not theme ink.
 */
export function WhatsNewDialog() {
  const { t } = useTranslation();
  const open = useWhatsNewStore((s) => s.open);
  const entry = useWhatsNewStore((s) => s.entry);
  const dismiss = useWhatsNewStore((s) => s.dismiss);

  useEffect(() => {
    void useWhatsNewStore.getState().maybeShowOnBoot();
  }, []);

  if (!entry) return null;

  const milestone = entry.presentation === "milestone";
  const displayVersion = milestone
    ? entry.version.split(".").slice(0, 2).join(".")
    : entry.version;

  const openReleaseNotes = () => {
    invoke(CMD.openExternalUrl, { url: githubReleaseUrl(entry.version) }).catch(
      (err) => console.warn("[open_external_url] failed", err),
    );
  };

  return (
    <RD.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) dismiss();
      }}
    >
      <RD.Portal>
        <RD.Overlay
          className={cn(
            "fixed inset-0 z-[100] overlay-scrim",
            "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
          )}
        />
        <RD.Content
          aria-describedby={milestone ? `whats-new-summary-${entry.version}` : undefined}
          data-presentation={entry.presentation ?? "standard"}
          className={cn(
            "fixed left-1/2 top-1/2 z-[101] flex max-h-[90dvh] max-w-[calc(100vw-48px)]",
            "-translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden",
            "rounded-lg border border-hairline surface-raised",
            "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
            milestone ? "w-[680px]" : "w-[520px]",
          )}
        >
          {/* The image remains a replaceable release asset. Layout and contrast do not depend on it. */}
          <div
            className={cn(
              "relative shrink-0 select-none overflow-hidden",
              milestone ? "h-[208px]" : "h-[216px]",
            )}
          >
            <img
              src={milestone ? milestoneHeroImage : heroImage}
              alt=""
              draggable={false}
              className="absolute inset-0 h-full w-full object-cover"
              style={{ objectPosition: milestone ? "50% 42%" : "50% 30%" }}
            />
            <div className="absolute inset-0 bg-gradient-to-r from-media-scrim-strong via-media-scrim to-transparent" />
            {milestone ? (
              <div className="absolute inset-0 flex flex-col justify-between px-28px py-20px text-on-media">
                <div className="flex items-center gap-10px">
                  <img
                    src={appIcon}
                    alt=""
                    draggable={false}
                    className="h-[34px] w-[34px] drop-shadow-xl"
                  />
                  <span className="editorial-caps text-on-media/80">
                    {t("whatsNew.milestoneLabel")}
                  </span>
                </div>
                <div>
                  <p className="text-label font-medium tracking-label text-on-media/70">
                    {t("whatsNew.milestoneEdition")}
                  </p>
                  <p className="font-display text-display-l font-medium leading-none tracking-[-0.05em] text-on-media">
                    {displayVersion}
                  </p>
                </div>
              </div>
            ) : (
              <img
                src={appIcon}
                alt=""
                draggable={false}
                className="absolute left-1/2 top-[42%] h-[76px] w-[76px] -translate-x-1/2 -translate-y-1/2 drop-shadow-xl"
              />
            )}
            <div className="absolute inset-x-0 bottom-0 h-[72px] bg-gradient-to-b from-transparent to-surface-card" />
          </div>

          <div
            className={cn(
              "min-h-0 overflow-y-auto px-28px pb-20px",
              milestone && "pt-4px",
            )}
          >
            <p className={cn("editorial-caps", !milestone && "text-center")}>
              {t("whatsNew.eyebrow", { version: entry.version })}
            </p>
            <RD.Title
              className={cn(
                "mt-6px font-display font-medium text-ink",
                milestone ? "text-display" : "text-center text-display-s",
              )}
            >
              {t(entry.titleKey)}
            </RD.Title>

            {entry.summaryKey ? (
              <p
                id={`whats-new-summary-${entry.version}`}
                className="mt-8px max-w-[590px] text-content leading-[1.5] text-muted"
              >
                {t(entry.summaryKey)}
              </p>
            ) : null}

            <ul
              className={cn(
                "mt-22px",
                milestone
                  ? "mt-16px grid grid-cols-2 gap-6px border-y border-hairline-soft py-8px"
                  : "flex flex-col gap-16px border-t border-hairline-soft pt-20px",
              )}
            >
              {entry.highlights.map((h) => (
                <li
                  key={h.titleKey}
                  className={cn(
                    "flex items-start gap-12px",
                    milestone && "rounded-md px-8px py-8px hover:bg-canvas-soft",
                  )}
                >
                  <span
                    className={cn(
                      "mt-[1px] flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-sm border",
                      milestone
                        ? "border-hairline bg-canvas-soft text-muted"
                        : "border-hairline text-muted",
                    )}
                  >
                    <Icon icon={h.icon} size={14} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-ui font-medium text-ink">
                      {t(h.titleKey)}
                    </span>
                    <span className="mt-[2px] block text-caption leading-[1.5] text-muted">
                      {t(h.bodyKey)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>

            <div
              className={cn(
                "mt-14px flex gap-16px",
                milestone ? "items-center justify-between" : "flex-col-reverse items-stretch",
              )}
            >
              <button
                type="button"
                onClick={openReleaseNotes}
                className={cn(
                  "group inline-flex items-center gap-4px rounded-xs text-caption text-muted",
                  "transition-colors duration-fast hover:text-ink",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[2px]",
                )}
              >
                <span className="underline decoration-1 decoration-hairline underline-offset-[3px] transition-colors duration-fast group-hover:decoration-muted">
                  {t("whatsNew.releaseNotes")}
                </span>
                <Icon icon={ArrowUpRight} size={10} className="opacity-60" />
              </button>

              <RD.Close asChild>
                <Button
                  variant="primary"
                  size="lg"
                  className={cn("rounded-pill", !milestone && "w-full")}
                >
                  {t("whatsNew.cta")}
                </Button>
              </RD.Close>
            </div>
          </div>

          <RD.Close asChild>
            <button
              type="button"
              aria-label={t("common.closeDialog")}
              className={cn(
                "press-feedback absolute right-[12px] top-[12px] flex h-[26px] w-[26px] items-center justify-center",
                "rounded-pill bg-media-scrim text-on-media transition-colors duration-fast",
                "hover:bg-media-scrim-strong",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-on-media focus-visible:outline-offset-[2px]",
              )}
            >
              <Icon icon={X} size={12} />
            </button>
          </RD.Close>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
