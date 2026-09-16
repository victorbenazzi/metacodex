import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";

import { Copy, Minus, Square, X } from "@/components/ui/icons";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/cn";
import { hasCustomWindowControls } from "@/lib/platform";

/**
 * Window controls for undecorated Windows and Linux windows. macOS keeps its
 * native traffic lights over the application chrome.
 */
export function DesktopWindowControls() {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!hasCustomWindowControls) return;
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
      // Tauri window APIs are missing outside a native window or during HMR.
    }
    return () => {
      unlisten?.();
    };
  }, []);

  if (!hasCustomWindowControls) return null;

  const minimize = () => {
    try {
      void getCurrentWindow().minimize().catch(() => undefined);
    } catch {
      // Ignore calls made while the native window is reloading.
    }
  };
  const toggleMaximize = () => {
    try {
      void getCurrentWindow().toggleMaximize().catch(() => undefined);
    } catch {
      // Ignore calls made while the native window is reloading.
    }
  };
  const close = () => {
    try {
      void getCurrentWindow().close().catch(() => undefined);
    } catch {
      // Ignore calls made while the native window is reloading.
    }
  };

  return (
    <div className="fixed right-0 top-0 z-50 flex h-[36px]">
      <ControlButton onClick={minimize} label={t("titleBar.minimize")}>
        <Icon icon={Minus} size={12} />
      </ControlButton>
      <ControlButton
        onClick={toggleMaximize}
        label={maximized ? t("titleBar.restore") : t("titleBar.maximize")}
      >
        <Icon icon={maximized ? Copy : Square} size={12} />
      </ControlButton>
      <ControlButton onClick={close} label={t("titleBar.close")} danger>
        <Icon icon={X} size={12} />
      </ControlButton>
    </div>
  );
}

function ControlButton({
  onClick,
  label,
  danger,
  children,
}: {
  onClick: () => void;
  label: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <IconButton
      size="lg"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "h-[36px] w-[46px]",
        danger && "hover:bg-win-close hover:text-white",
      )}
    >
      {children}
    </IconButton>
  );
}
