import { useTranslation } from "react-i18next";

import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FullScreen,
  Globe,
  ImagePlus,
  Loader2,
  MinimizeScreen,
  PenTool,
  RefreshCw,
  Settings2,
  Square,
  Target,
} from "@/components/ui/icons";
import type {
  BrowserContextDetail,
  BrowserMode,
} from "@/features/browser/browser.service";
import type { BrowserFeedback } from "@/features/browser/useBrowserNavigation";
import { cn } from "@/lib/cn";

interface BrowserChromeProps {
  address: string;
  mode: BrowserMode;
  contextDetail: BrowserContextDetail;
  loading: boolean;
  expanded: boolean;
  pageLoaded: boolean;
  capturing: boolean;
  notice: BrowserFeedback | null;
  onAddressChange: (address: string) => void;
  onGo: (address: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onMode: (mode: BrowserMode) => void;
  onCaptureViewport: () => void;
  onToggleExpand: () => void;
  onContextDetail: (detail: BrowserContextDetail) => void;
  onOpenExternal: () => void;
  onHome: () => void;
}

export function BrowserChrome(props: BrowserChromeProps) {
  const { t } = useTranslation();
  return (
    <div className="flex h-[36px] shrink-0 items-center gap-4px border-b border-hairline-soft px-8px">
      <ChromeButton
        label={t("browser.back")}
        icon={ChevronLeft}
        disabled={props.capturing || !props.pageLoaded}
        onClick={props.onBack}
      />
      <ChromeButton
        label={t("browser.forward")}
        icon={ChevronRight}
        disabled={props.capturing || !props.pageLoaded}
        onClick={props.onForward}
      />
      <ChromeButton
        label={t("browser.reload")}
        icon={props.loading ? Loader2 : RefreshCw}
        iconClassName={props.loading ? "animate-spin" : undefined}
        disabled={props.capturing || !props.pageLoaded}
        onClick={props.onReload}
      />
      <form
        className="min-w-0 flex-1"
        onSubmit={(event) => {
          event.preventDefault();
          if (props.capturing) return;
          props.onGo(props.address);
        }}
      >
        <label className="sr-only" htmlFor="browser-address">
          {t("browser.addressLabel")}
        </label>
        <input
          id="browser-address"
          value={props.address}
          disabled={props.capturing}
          onChange={(event) => props.onAddressChange(event.currentTarget.value)}
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
      {props.notice ? (
        <span
          className={cn(
            "max-w-[160px] shrink-0 truncate text-caption",
            props.notice.tone === "error" ? "text-danger" : "text-muted",
          )}
        >
          {props.notice.detail
            ? `${props.notice.title}: ${props.notice.detail}`
            : props.notice.title}
        </span>
      ) : null}
      {props.pageLoaded ? (
        <>
          <ChromeButton
            label={props.mode === "pick" ? t("browser.pickHint") : t("browser.pick")}
            icon={Target}
            disabled={props.capturing}
            pressed={props.mode === "pick"}
            onClick={() => props.onMode(props.mode === "pick" ? "browse" : "pick")}
          />
          <ChromeButton
            label={t("browser.draw")}
            icon={PenTool}
            disabled={props.capturing}
            pressed={props.mode === "draw"}
            onClick={() => props.onMode(props.mode === "draw" ? "browse" : "draw")}
          />
          <ChromeButton
            label={t("browser.captureViewport")}
            icon={props.capturing ? Loader2 : ImagePlus}
            iconClassName={props.capturing ? "animate-spin" : undefined}
            disabled={props.capturing}
            onClick={props.onCaptureViewport}
          />
          <ChromeButton
            label={t("browser.captureRegion")}
            icon={Square}
            iconSize={11}
            disabled={props.capturing}
            pressed={props.mode === "capture"}
            onClick={() => props.onMode(props.mode === "capture" ? "browse" : "capture")}
          />
          <ChromeButton
            label={`${t("browser.contextDetail")}: ${t(
              props.contextDetail === "compact"
                ? "browser.contextCompact"
                : "browser.contextDiagnostic",
            )}`}
            icon={Settings2}
            pressed={props.contextDetail === "diagnostic"}
            onClick={() => props.onContextDetail(
              props.contextDetail === "compact" ? "diagnostic" : "compact",
            )}
          />
          <ChromeButton
            label={t("browser.openExternal")}
            icon={ExternalLink}
            onClick={props.onOpenExternal}
          />
          <ChromeButton
            label={t("browser.home")}
            icon={Globe}
            disabled={props.capturing}
            onClick={props.onHome}
          />
          <ChromeButton
            label={props.expanded ? t("browser.restore") : t("browser.expand")}
            icon={props.expanded ? MinimizeScreen : FullScreen}
            pressed={props.expanded}
            onClick={props.onToggleExpand}
          />
        </>
      ) : null}
    </div>
  );
}

function ChromeButton(props: {
  label: string;
  icon: typeof ChevronLeft;
  iconSize?: number;
  iconClassName?: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <IconButton
      size="md"
      aria-label={props.label}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      className={props.pressed ? "bg-surface-strong text-ink" : undefined}
      onClick={props.onClick}
    >
      <Icon
        icon={props.icon}
        size={props.iconSize ?? 13}
        className={props.iconClassName}
      />
    </IconButton>
  );
}
