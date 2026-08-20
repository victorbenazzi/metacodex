import { ExternalLink, Globe, Server } from "@/components/ui/icons";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { useTranslation } from "react-i18next";

import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRoot,
  ContextMenuTrigger,
} from "@/components/ui/ContextMenu";
import type { BrowserHistoryEntry, DevServer } from "@/features/browser/browser.service";
import {
  hostLabel,
  serverForUrl,
  serverTitle,
} from "@/features/browser/identity";
import { cn } from "@/lib/cn";

export type BrowserOpenTarget = "app" | "system";

export function BrowserStartPage({
  servers,
  recents,
  onOpen,
}: {
  servers: DevServer[];
  recents: BrowserHistoryEntry[];
  onOpen: (url: string, target: BrowserOpenTarget) => void;
}) {
  const { t } = useTranslation();
  const external = t("browser.external");

  return (
    <div className="h-full overflow-y-auto px-18px py-20px">
      <p className="font-display text-title text-ink">{t("browser.startTitle")}</p>
      <p className="mt-6px max-w-[360px] text-caption leading-[1.5] text-muted">
        {t("browser.startBody")}
      </p>

      <p className="mb-8px mt-22px text-label text-muted">{t("browser.servers")}</p>
      {servers.length === 0 ? (
        <p className="text-caption text-muted-soft">{t("browser.serversEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-2px">
          {servers.map((server) => (
            <li key={server.url}>
              <UrlRow
                icon={Server}
                title={serverTitle(server, external)}
                detail={hostLabel(server.url)}
                url={server.url}
                onOpen={onOpen}
              />
            </li>
          ))}
        </ul>
      )}

      <p className="mb-8px mt-22px text-label text-muted">{t("browser.recents")}</p>
      {recents.length === 0 ? (
        <p className="text-caption text-muted-soft">{t("browser.recentsEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-2px">
          {recents.map((entry) => {
            const matched = serverForUrl(entry.url, servers);
            const host = hostLabel(entry.url);
            const title = matched
              ? serverTitle(matched, external)
              : entry.title && entry.title !== entry.url
                ? entry.title
                : host;
            return (
              <li key={`${entry.url}-${entry.visitedAt}`}>
                <UrlRow
                  icon={Globe}
                  title={title}
                  detail={host}
                  url={entry.url}
                  onOpen={onOpen}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function UrlRow({
  icon: Glyph,
  title,
  detail,
  url,
  onOpen,
}: {
  icon: typeof Globe;
  title: string;
  detail: string;
  url: string;
  onOpen: (url: string, target: BrowserOpenTarget) => void;
}) {
  const { t } = useTranslation();
  const same = title === detail;
  return (
    <ContextMenuRoot>
      <ContextMenuTrigger asChild>
        <Button
          variant="ghost"
          size="md"
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey) {
              e.preventDefault();
              onOpen(url, "system");
              return;
            }
            onOpen(url, "app");
          }}
          className={cn(
            "h-auto w-full justify-start gap-8px px-8px py-7px text-left font-normal tracking-normal",
            "transition-colors duration-fast",
            "hover:bg-surface-strong",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong",
          )}
        >
          <Icon icon={Glyph} size={13} className="self-start text-muted" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-caption text-ink">{title}</span>
            {same ? null : (
              <span className="mt-2px block truncate text-micro text-muted-soft">{detail}</span>
            )}
          </span>
        </Button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>{t("browser.openWhere")}</ContextMenuLabel>
        <ContextMenuItem onSelect={() => onOpen(url, "app")}>
          <Icon icon={Globe} size={12} className="text-muted" />
          <span>{t("browser.openInApp")}</span>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onOpen(url, "system")}>
          <Icon icon={ExternalLink} size={12} className="text-muted" />
          <span>{t("browser.openExternal")}</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenuRoot>
  );
}
