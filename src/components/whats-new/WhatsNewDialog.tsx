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
            "fixed inset-0 z-[100] bg-scrim",
            "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
          )}
        />
        <RD.Content
          aria-describedby={undefined}
          className={cn(
            "fixed left-1/2 top-1/2 z-[101] flex max-h-[85dvh] w-[520px] max-w-[calc(100vw-48px)]",
            "-translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden",
            "rounded-lg border border-hairline bg-surface-card shadow-elevated",
            "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
          )}
        >
          {/* Hero: fixed dark artwork with the app icon at the warp's focal point. */}
          <div className="relative h-[216px] shrink-0 select-none">
            <img
              src={heroImage}
              alt=""
              draggable={false}
              className="absolute inset-0 h-full w-full object-cover"
              style={{ objectPosition: "50% 30%" }}
            />
            <img
              src={appIcon}
              alt=""
              draggable={false}
              className="absolute left-1/2 top-[42%] h-[76px] w-[76px] -translate-x-1/2 -translate-y-1/2 drop-shadow-xl"
            />
            {/* Blend the artwork into the card so the sheet reads as one piece. */}
            <div className="absolute inset-x-0 bottom-0 h-[72px] bg-gradient-to-b from-transparent to-surface-card" />
          </div>

          <div className="min-h-0 overflow-y-auto px-32px pb-24px">
            <p className="editorial-caps text-center">
              {t("whatsNew.eyebrow", { version: entry.version })}
            </p>
            <RD.Title className="mt-6px text-center font-display text-display-s font-medium text-ink">
              {t(entry.titleKey)}
            </RD.Title>

            <ul className="mt-22px flex flex-col gap-16px border-t border-hairline-soft pt-20px">
              {entry.highlights.map((h) => (
                <li key={h.titleKey} className="flex items-start gap-12px">
                  <span className="mt-[1px] flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-sm border border-hairline text-muted">
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

            <RD.Close asChild>
              <Button
                variant="primary"
                size="lg"
                className="mt-24px w-full rounded-pill"
              >
                {t("whatsNew.cta")}
              </Button>
            </RD.Close>

            <div className="mt-12px flex justify-center">
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
