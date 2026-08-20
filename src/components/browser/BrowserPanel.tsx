import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Tooltip } from "@/components/ui/Tooltip";
import { BrowserStartPage, type BrowserOpenTarget } from "@/components/browser/BrowserStartPage";
import { BROWSER_DRAW_DOCK_H, BrowserDrawDock } from "@/components/browser/BrowserDrawDock";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  ExternalLink,
  FullScreen,
  Globe,
  ImagePlus,
  Loader2,
  MinimizeScreen,
  MoreHorizontal,
  PenTool,
  RefreshCw,
  Square,
  Target,
} from "@/components/ui/icons";
import { Kbd } from "@/components/ui/Kbd";
import {
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownRoot,
  DropdownSeparator,
  DropdownTrigger,
} from "@/components/ui/DropdownMenu";
import { useBrowserUiStore } from "@/features/browser/browser.store";
import {
  browserApi,
  type DevServer,
  type BrowserContextDetail,
  type BrowserMode,
  type BrowserPick,
} from "@/features/browser/browser.service";
import { formatPickContext } from "@/features/browser/context";
import { formatVisualContext, sendVisualToCli } from "@/features/browser/sendToAgent";
import { useBrowserRuntimeContext } from "@/features/browser/useBrowserRuntimeContext";
import { isBlankBrowserUrl, normalizeBrowserUrl } from "@/features/browser/url";
import { useChromeOverlayOpen } from "@/features/ui/overlayLock.store";
import { useToastStore } from "@/features/ui/toast.store";
import { ptyApi } from "@/features/terminal/terminal.service";
import { CMD, invoke, isAppError } from "@/lib/ipc";
import {
  EV,
  listenWhileMounted,
  type BrowserNavigatedPayload,
} from "@/lib/events";
import { cn } from "@/lib/cn";

interface BrowserPanelProps {
  active: boolean;
}

export function BrowserPanel({ active }: BrowserPanelProps) {
  const { t } = useTranslation();
  const url = useBrowserUiStore((s) => s.url);
  const address = useBrowserUiStore((s) => s.address);
  const mode = useBrowserUiStore((s) => s.mode);
  const contextDetail = useBrowserUiStore((s) => s.contextDetail);
  const loading = useBrowserUiStore((s) => s.loading);
  const setUrl = useBrowserUiStore((s) => s.setUrl);
  const setAddress = useBrowserUiStore((s) => s.setAddress);
  const setMode = useBrowserUiStore((s) => s.setMode);
  const setContextDetail = useBrowserUiStore((s) => s.setContextDetail);
  const setLoading = useBrowserUiStore((s) => s.setLoading);
  const expanded = useBrowserUiStore((s) => s.expanded);
  const toggleExpanded = useBrowserUiStore((s) => s.toggleExpanded);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const boundsRaf = useRef(0);
  const captureInFlight = useRef(false);
  const pickInFlight = useRef(false);
  const overlayOpen = useChromeOverlayOpen();
  const { browserTabOpen, servers } = useBrowserRuntimeContext();
  const [capturing, setCapturing] = useState(false);
  const [stoppingServerIds, setStoppingServerIds] = useState<Set<string>>(() => new Set());
  const startPage = isBlankBrowserUrl(url);
  const pageLive = active && !startPage && !overlayOpen;

  const changeMode = useCallback(
    async (next: BrowserMode) => {
      setMode(next);
      try {
        await browserApi.setMode(next);
      } catch (err) {
        console.warn("[browser] setMode failed", err);
      }
    },
    [setMode],
  );

  useEffect(() => {
    if (!browserTabOpen) useBrowserUiStore.getState().setExpanded(false);
  }, [browserTabOpen]);

  useEffect(() => {
    return listenWhileMounted<BrowserNavigatedPayload>(EV.browserNavigated, (event) => {
      const next = event.payload;
      if (isBlankBrowserUrl(next.url) || next.url.includes("mcx.invalid")) {
        setUrl(null);
        setAddress("");
        setLoading(false);
        return;
      }
      setLoading(next.loading);
      setUrl(next.url, next.title || undefined);
    });
  }, [setAddress, setLoading, setUrl]);

  useEffect(() => {
    return listenWhileMounted(EV.browserPicked, () => {
      if (pickInFlight.current) return;
      pickInFlight.current = true;
      void browserApi
        .takePick()
        .then(async (pick) => {
          if (!pick) return;
          await changeMode("browse");
          await sendPickToAgent(pick, t, contextDetail);
        })
        .catch(() => undefined)
        .finally(() => {
          pickInFlight.current = false;
        });
    });
  }, [changeMode, contextDetail, t]);

  useEffect(() => {
    const live = new Set(servers.map((server) => server.id));
    setStoppingServerIds((current) => {
      const next = new Set(Array.from(current).filter((id) => live.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [servers]);

  useEffect(() => {
    return listenWhileMounted(EV.browserEscape, () => {
      void changeMode("browse");
    });
  }, [changeMode]);

  const syncBounds = useCallback(() => {
    if (boundsRaf.current) return;
    boundsRaf.current = requestAnimationFrame(() => {
      boundsRaf.current = 0;
      const el = hostRef.current;
      if (!pageLive || !el) {
        void browserApi.hide().catch(() => undefined);
        return;
      }
      const rect = el.getBoundingClientRect();
      const dock = mode === "draw" ? BROWSER_DRAW_DOCK_H : 0;
      void browserApi
        .setBounds({
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: Math.max(0, rect.height - dock),
          visible: rect.width >= 8 && rect.height - dock >= 8,
        })
        .catch((err) => console.warn("[browser] bounds failed", err));
    });
  }, [mode, pageLive]);

  useLayoutEffect(() => {
    syncBounds();
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => syncBounds());
    ro.observe(el);
    window.addEventListener("resize", syncBounds);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", syncBounds);
      if (boundsRaf.current) cancelAnimationFrame(boundsRaf.current);
    };
  }, [syncBounds, expanded]);

  useLayoutEffect(() => {
    if (active) return;
    void browserApi.hide().catch(() => undefined);
    void browserApi.setMode("browse").catch(() => undefined);
    useBrowserUiStore.getState().setMode("browse");
  }, [active]);

  useEffect(() => {
    return () => {
      void browserApi.hide().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (!active || mode === "browse") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      void changeMode("browse");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, changeMode, mode]);

  const go = useCallback(
    async (raw: string, target: BrowserOpenTarget = "app") => {
      const next = normalizeBrowserUrl(raw);
      if (!next) {
        useToastStore.getState().push({
          tone: "error",
          title: t("browser.invalidAddress"),
        });
        return;
      }
      if (target === "system") {
        void invoke(CMD.openExternalUrl, { url: next }).catch(() => undefined);
        return;
      }
      setAddress(next);
      setLoading(true);
      try {
        await browserApi.navigate(next);
        setUrl(next);
      } catch (err) {
        setLoading(false);
        setUrl(useBrowserUiStore.getState().url);
        useToastStore.getState().push({
          tone: "error",
          title: t("browser.navigateFailed"),
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [setAddress, setLoading, setUrl, t],
  );

  const sendScreenshot = useCallback(async (crop?: BrowserPick["rect"]) => {
    if (captureInFlight.current) return;
    captureInFlight.current = true;
    setCapturing(true);
    try {
      const shot = await browserApi.capture(crop);
      const page = useBrowserUiStore.getState().url;
      const body = formatVisualContext([
        "Visual context from in-app browser",
        page ? `url: ${page}` : null,
        crop ? "target: region" : "target: viewport",
        crop
          ? `rect: ${Math.round(crop.x)},${Math.round(crop.y)} ${Math.round(crop.width)}x${Math.round(crop.height)}`
          : null,
        `screenshot: ${shot.path}`,
      ]);
      const result = await sendVisualToCli(body);
      if (result.status === "no-cli") {
        useToastStore.getState().push({
          tone: "error",
          title: t("browser.needAgent"),
        });
        return;
      }
      if (result.status === "failed") {
        useToastStore.getState().push({
          tone: "error",
          title: t("browser.sendFailed"),
          detail: result.error.message,
        });
        return;
      }
      useToastStore.getState().push({
        tone: "success",
        title: t("browser.sentToAgent"),
      });
      if (mode !== "browse") await changeMode("browse");
    } catch (err) {
      useToastStore.getState().push({
        tone: "error",
        title: t("browser.captureFailed"),
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      captureInFlight.current = false;
      setCapturing(false);
    }
  }, [changeMode, mode, t]);

  useEffect(() => {
    return listenWhileMounted(EV.browserCaptureSelected, () => {
      setMode("browse");
      void browserApi.setMode("browse").catch(() => undefined);
      void (async () => {
        try {
          const rect = await browserApi.takeCaptureRegion();
          if (!rect) throw new Error(t("browser.captureRegionMissing"));
          await sendScreenshot(rect);
        } catch (error) {
          useToastStore.getState().push({
            tone: "error",
            title: t("browser.captureFailed"),
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    });
  }, [sendScreenshot, setMode, t]);

  const stopServer = useCallback(
    async (server: DevServer) => {
      if (!server.pid || stoppingServerIds.has(server.id)) return;
      setStoppingServerIds((current) => new Set(current).add(server.id));
      try {
        await ptyApi.killProcess(server.sessionId, server.pid);
        useToastStore.getState().push({
          tone: "success",
          title: t("browser.serverStopped"),
        });
      } catch (error) {
        setStoppingServerIds((current) => {
          const next = new Set(current);
          next.delete(server.id);
          return next;
        });
        useToastStore.getState().push({
          tone: "error",
          title: t("browser.stopServerFailed"),
          detail: isAppError(error)
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error),
        });
      }
    },
    [stoppingServerIds, t],
  );

  const pageTools = !startPage;

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={t("browser.aria")}>
      <div className="flex h-[36px] shrink-0 items-center gap-4px border-b border-hairline-soft px-8px">
        <Tooltip content={t("browser.back")} side="bottom">
          <IconButton
            size="md"
            aria-label={t("browser.back")}
            disabled={startPage}
            onClick={() => void browserApi.goBack().catch(() => undefined)}
          >
            <Icon icon={ChevronLeft} size={14} />
          </IconButton>
        </Tooltip>
        <Tooltip content={t("browser.forward")} side="bottom">
          <IconButton
            size="md"
            aria-label={t("browser.forward")}
            disabled={startPage}
            onClick={() => void browserApi.goForward().catch(() => undefined)}
          >
            <Icon icon={ChevronRight} size={14} />
          </IconButton>
        </Tooltip>
        <Tooltip content={t("browser.reload")} side="bottom">
          <IconButton
            size="md"
            aria-label={t("browser.reload")}
            disabled={startPage}
            onClick={() => void browserApi.reload().catch(() => undefined)}
          >
            <Icon
              icon={loading ? Loader2 : RefreshCw}
              size={13}
              className={loading ? "animate-spin" : undefined}
            />
          </IconButton>
        </Tooltip>
        <form
          className="min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            void go(address);
          }}
        >
          <label className="sr-only" htmlFor="browser-address">
            {t("browser.addressLabel")}
          </label>
          <input
            id="browser-address"
            value={address}
            onChange={(e) => setAddress(e.currentTarget.value)}
            placeholder={t("browser.addressPlaceholder")}
            autoComplete="off"
            spellCheck={false}
            className={cn(
              "h-[26px] w-full rounded-sm border border-hairline-soft bg-canvas-soft px-10px",
              "text-caption text-ink outline-none placeholder:text-muted-soft",
              "focus-visible:border-hairline-strong",
            )}
          />
        </form>
        {pageTools ? (
          <>
            <Tooltip
              content={mode === "pick" ? t("browser.pickHint") : t("browser.pick")}
              side="bottom"
            >
              <IconButton
                size="md"
                aria-label={t("browser.pick")}
                className={mode === "pick" ? "bg-surface-strong text-ink" : undefined}
                onClick={() => void changeMode(mode === "pick" ? "browse" : "pick")}
              >
                <Icon icon={Target} size={13} />
              </IconButton>
            </Tooltip>
            <Tooltip content={t("browser.draw")} side="bottom">
              <IconButton
                size="md"
                aria-label={t("browser.draw")}
                className={mode === "draw" ? "bg-surface-strong text-ink" : undefined}
                onClick={() => void changeMode(mode === "draw" ? "browse" : "draw")}
              >
                <Icon icon={PenTool} size={13} />
              </IconButton>
            </Tooltip>
            <DropdownRoot>
              <Tooltip content={t("browser.screenshot")} side="bottom">
                <DropdownTrigger asChild>
                  <IconButton
                    size="md"
                    aria-label={t("browser.screenshot")}
                    disabled={capturing}
                    className={mode === "capture" ? "bg-surface-strong text-ink" : undefined}
                  >
                    <Icon
                      icon={capturing ? Loader2 : ImagePlus}
                      size={13}
                      className={capturing ? "animate-spin" : undefined}
                    />
                  </IconButton>
                </DropdownTrigger>
              </Tooltip>
              <DropdownContent align="end" sideOffset={6} className="min-w-[190px]">
                <DropdownItem onSelect={() => void sendScreenshot()}>
                  <Icon icon={FullScreen} size={12} className="text-muted" />
                  <span>{t("browser.captureViewport")}</span>
                </DropdownItem>
                <DropdownItem onSelect={() => void changeMode("capture")}>
                  <Icon icon={Square} size={11} className="text-muted" />
                  <span>{t("browser.captureRegion")}</span>
                </DropdownItem>
              </DropdownContent>
            </DropdownRoot>
            <Tooltip
              content={expanded ? t("browser.restore") : t("browser.expand")}
              side="bottom"
              shortcut={<Kbd keys={["Mod", "Alt", "M"]} />}
            >
              <IconButton
                size="md"
                aria-label={expanded ? t("browser.restore") : t("browser.expand")}
                className={expanded ? "bg-surface-strong text-ink" : undefined}
                onClick={() => toggleExpanded()}
              >
                <Icon icon={expanded ? MinimizeScreen : FullScreen} size={13} />
              </IconButton>
            </Tooltip>
          </>
        ) : null}
        <DropdownRoot>
          <DropdownTrigger asChild>
            <IconButton size="md" aria-label={t("common.more")}>
              <Icon icon={MoreHorizontal} size={14} />
            </IconButton>
          </DropdownTrigger>
          <DropdownContent align="end" sideOffset={6} className="min-w-[200px]">
            {pageTools ? (
              <>
                <DropdownLabel>{t("browser.contextDetail")}</DropdownLabel>
                <DropdownItem
                  onSelect={() => setContextDetail("compact")}
                  trailing={
                    contextDetail === "compact" ? <Icon icon={Check} size={12} /> : null
                  }
                >
                  <span>{t("browser.contextCompact")}</span>
                </DropdownItem>
                <DropdownItem
                  onSelect={() => setContextDetail("diagnostic")}
                  trailing={
                    contextDetail === "diagnostic" ? <Icon icon={Check} size={12} /> : null
                  }
                >
                  <span>{t("browser.contextDiagnostic")}</span>
                </DropdownItem>
                <DropdownSeparator />
              </>
            ) : null}
            <DropdownItem
              disabled={startPage}
              onSelect={() => {
                const current = useBrowserUiStore.getState().url;
                if (current) {
                  void invoke(CMD.openExternalUrl, { url: current }).catch(() => undefined);
                }
              }}
            >
              <Icon icon={ExternalLink} size={12} className="text-muted" />
              <span>{t("browser.openExternal")}</span>
            </DropdownItem>
            <DropdownItem
              onSelect={() => {
                setUrl(null);
                setAddress("");
                void changeMode("browse");
                void browserApi.hide().catch(() => undefined);
              }}
            >
              <Icon icon={Globe} size={12} className="text-muted" />
              <span>{t("browser.home")}</span>
            </DropdownItem>
          </DropdownContent>
        </DropdownRoot>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={hostRef}
          className="absolute inset-0"
          style={{ display: startPage ? "none" : "block" }}
        />
        {!startPage && mode === "draw" ? (
          <BrowserDrawDock
            sending={capturing}
            onSend={() => void sendScreenshot()}
            onClear={() => void browserApi.clearDraw().catch(() => undefined)}
            onCancel={() => void changeMode("browse")}
          />
        ) : null}
        {startPage ? (
          <BrowserStartPage
            servers={servers}
            stoppingServerIds={stoppingServerIds}
            onOpen={(next, target) => void go(next, target)}
            onStop={(server) => void stopServer(server)}
          />
        ) : null}
      </div>
    </section>
  );
}

async function sendPickToAgent(
  pick: BrowserPick,
  t: (key: string) => string,
  contextDetail: BrowserContextDetail,
): Promise<void> {
  let screenshotPath: string | null = null;
  try {
    const shot = await browserApi.capture(pick.rect);
    screenshotPath = shot.path;
  } catch (err) {
    console.warn("[browser] capture after pick failed", err);
  }
  const result = await sendVisualToCli(
    formatPickContext(pick, screenshotPath, contextDetail),
  );
  if (result.status === "no-cli") {
    useToastStore.getState().push({
      tone: "error",
      title: t("browser.needAgent"),
    });
    return;
  }
  if (result.status === "failed") {
    useToastStore.getState().push({
      tone: "error",
      title: t("browser.sendFailed"),
      detail: result.error.message,
    });
    return;
  }
  useToastStore.getState().push({ tone: "success", title: t("browser.sentToAgent") });
}
