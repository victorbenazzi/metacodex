import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "@/components/ui/icons";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { isWindows } from "@/lib/platform";

/**
 * Min / toggle-maximize / close for Windows. Native decorations are off
 * there (see tauri.windows.conf.json). Absolutely positioned so the rest of
 * the chrome does not shift.
 */
export function WindowsControls() {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isWindows) return;
    let unlisten: (() => void) | undefined;
    try {
      const win = getCurrentWindow();
      void win.isMaximized().then(setMaximized).catch(() => undefined);
      void win
        .onResized(() => {
          void win.isMaximized().then(setMaximized).catch(() => undefined);
        })
        .then((off) => {
          unlisten = off;
        });
    } catch {
      // Tauri window APIs are missing outside a native window (or during HMR).
    }
    return () => {
      unlisten?.();
    };
  }, []);

  if (!isWindows) return null;

  const minimize = () => {
    try {
      void getCurrentWindow().minimize().catch(() => undefined);
    } catch {
      // ignore
    }
  };
  const toggleMax = () => {
    try {
      void getCurrentWindow().toggleMaximize().catch(() => undefined);
    } catch {
      // ignore
    }
  };
  const close = () => {
    try {
      void getCurrentWindow().close().catch(() => undefined);
    } catch {
      // ignore
    }
  };

  return (
    <div className="fixed right-0 top-0 z-50 flex h-[36px]">
      <ControlButton
        onClick={minimize}
        title={t("titleBar.minimize")}
        ariaLabel={t("titleBar.minimize")}
      >
        <Icon icon={Minus} size={12} />
      </ControlButton>
      <ControlButton
        onClick={toggleMax}
        title={maximized ? t("titleBar.restore") : t("titleBar.maximize")}
        ariaLabel={maximized ? t("titleBar.restore") : t("titleBar.maximize")}
      >
        <Icon icon={maximized ? Copy : Square} size={12} />
      </ControlButton>
      <ControlButton onClick={close} title={t("titleBar.close")} ariaLabel={t("titleBar.close")} danger>
        <Icon icon={X} size={12} />
      </ControlButton>
    </div>
  );
}

function ControlButton({
  onClick,
  title,
  ariaLabel,
  danger,
  children,
}: {
  onClick: () => void;
  title: string;
  ariaLabel: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex h-[36px] w-[46px] items-center justify-center text-muted transition-colors duration-fast",
        danger
          ? "hover:bg-win-close hover:text-white"
          : "hover:bg-surface-strong/55 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
