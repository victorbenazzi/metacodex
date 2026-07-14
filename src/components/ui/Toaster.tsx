import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type TransitionEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { useToastStore, type Toast, type ToastTone } from "@/features/ui/toast.store";
import { cn } from "@/lib/cn";

const toneIcon: Record<ToastTone, typeof Info> = {
  info: Info,
  error: AlertCircle,
  success: CheckCircle2,
};

const toneAccent: Record<ToastTone, string> = {
  info: "text-ink",
  error: "text-danger",
  success: "text-ink",
};

type ToastVisualState = "entering" | "visible" | "exiting";

const STACK_FLIP_MS = 180;
const STACK_FLIP_EASING = "cubic-bezier(0.77, 0, 0.175, 1)";

interface ToastRowProps {
  toast: Toast;
  registerRow: (id: string, element: HTMLDivElement | null) => void;
  onSettledPosition: (id: string, rect: DOMRect) => void;
}

function ToastRow({ toast, registerRow, onSettledPosition }: ToastRowProps) {
  const { t } = useTranslation();
  const dismiss = useToastStore((s) => s.dismiss);
  const [visualState, setVisualState] = useState<ToastVisualState>("entering");
  const visualStateRef = useRef<ToastVisualState>("entering");
  const enterFrameRef = useRef(0);
  const autoDismissTimerRef = useRef(0);
  const removedRef = useRef(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const transitionRef = useRef<HTMLDivElement | null>(null);

  const setElementRef = useCallback(
    (element: HTMLDivElement | null) => {
      wrapperRef.current = element;
      registerRow(toast.id, element);
    },
    [registerRow, toast.id],
  );

  const finishDismiss = useCallback(() => {
    if (removedRef.current) return;
    removedRef.current = true;
    dismiss(toast.id);
  }, [dismiss, toast.id]);

  const beginDismiss = useCallback(() => {
    if (visualStateRef.current === "exiting" || removedRef.current) return;
    visualStateRef.current = "exiting";
    setVisualState("exiting");
    window.clearTimeout(autoDismissTimerRef.current);
  }, []);

  useEffect(() => {
    enterFrameRef.current = requestAnimationFrame(() => {
      if (visualStateRef.current !== "entering") return;
      visualStateRef.current = "visible";
      setVisualState("visible");
    });
    return () => cancelAnimationFrame(enterFrameRef.current);
  }, []);

  useEffect(() => {
    if (toast.durationMs <= 0) return;
    autoDismissTimerRef.current = window.setTimeout(beginDismiss, toast.durationMs);
    return () => window.clearTimeout(autoDismissTimerRef.current);
  }, [beginDismiss, toast.durationMs]);

  useEffect(() => {
    if (visualState !== "exiting") return;
    const element = transitionRef.current;
    if (!element) {
      finishDismiss();
      return;
    }

    const animations = element
      .getAnimations()
      .filter((animation) => animation.playState !== "finished");
    if (animations.length === 0) {
      finishDismiss();
      return;
    }

    let active = true;
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (active) finishDismiss();
    });
    return () => {
      active = false;
    };
  }, [finishDismiss, visualState]);

  useEffect(
    () => () => {
      cancelAnimationFrame(enterFrameRef.current);
      window.clearTimeout(autoDismissTimerRef.current);
    },
    [],
  );

  const handleTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (visualStateRef.current === "exiting" && event.propertyName === "opacity") {
      finishDismiss();
      return;
    }
    if (visualStateRef.current === "visible") {
      const wrapper = wrapperRef.current;
      if (wrapper) onSettledPosition(toast.id, wrapper.getBoundingClientRect());
    }
  };

  return (
    <div ref={setElementRef} className="pointer-events-auto">
      <div
        ref={transitionRef}
        role="status"
        data-state={visualState}
        onTransitionEnd={handleTransitionEnd}
        className="toast-row pointer-events-auto flex w-[340px] items-start gap-[10px] rounded-lg border border-hairline bg-canvas/95 px-[14px] py-[11px] shadow-lg backdrop-blur-sm"
      >
        <Icon icon={toneIcon[toast.tone]} className={cn("mt-[1px] shrink-0", toneAccent[toast.tone])} size={16} />
        <div className="min-w-0 flex-1 space-y-[2px]">
          <p className="text-ui text-ink">{toast.title}</p>
          {toast.detail ? (
            <p className="break-words font-mono text-caption text-muted">{toast.detail}</p>
          ) : null}
        </div>
        <IconButton
          size="sm"
          aria-label={t("common.dismiss")}
          onClick={beginDismiss}
        >
          <Icon icon={X} size={14} />
        </IconButton>
      </div>
    </div>
  );
}

/** Global toast outlet. Mounted once near the app root. */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const rowElements = useRef<Map<string, HTMLDivElement>>(new Map());
  const previousRects = useRef<Map<string, DOMRect>>(new Map());
  const stackAnimations = useRef<Map<string, Animation>>(new Map());

  const registerRow = useCallback((id: string, element: HTMLDivElement | null) => {
    if (element) {
      rowElements.current.set(id, element);
      return;
    }
    rowElements.current.delete(id);
    previousRects.current.delete(id);
    stackAnimations.current.get(id)?.cancel();
    stackAnimations.current.delete(id);
  }, []);

  const recordSettledPosition = useCallback((id: string, rect: DOMRect) => {
    previousRects.current.set(id, rect);
  }, []);

  useLayoutEffect(() => {
    const liveIds = new Set(toasts.map((toast) => toast.id));
    for (const [id, animation] of stackAnimations.current) {
      if (liveIds.has(id)) continue;
      animation.cancel();
      stackAnimations.current.delete(id);
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nextRects = new Map(previousRects.current);

    for (const toast of toasts) {
      const element = rowElements.current.get(toast.id);
      if (!element) continue;

      const running = stackAnimations.current.get(toast.id);
      const first = running
        ? element.getBoundingClientRect()
        : previousRects.current.get(toast.id);
      running?.cancel();
      stackAnimations.current.delete(toast.id);

      const last = element.getBoundingClientRect();
      const motionElement = element.firstElementChild as HTMLElement | null;
      const visible = motionElement?.dataset.state === "visible";
      if (visible) nextRects.set(toast.id, last);
      else nextRects.delete(toast.id);

      if (reducedMotion || !visible || !first) continue;
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;

      const animation = element.animate(
        [
          { transform: `translate3d(${dx}px, ${dy}px, 0)` },
          { transform: "translate3d(0, 0, 0)" },
        ],
        { duration: STACK_FLIP_MS, easing: STACK_FLIP_EASING },
      );
      stackAnimations.current.set(toast.id, animation);
      const clear = () => {
        if (stackAnimations.current.get(toast.id) === animation) {
          stackAnimations.current.delete(toast.id);
        }
      };
      animation.onfinish = clear;
      animation.oncancel = clear;
    }

    previousRects.current = nextRects;
  }, [toasts]);

  useEffect(
    () => () => {
      for (const animation of stackAnimations.current.values()) animation.cancel();
      stackAnimations.current.clear();
    },
    [],
  );

  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-[16px] right-[16px] z-[1000] flex flex-col gap-[8px]">
      {toasts.map((tst) => (
        <ToastRow
          key={tst.id}
          toast={tst}
          registerRow={registerRow}
          onSettledPosition={recordSettledPosition}
        />
      ))}
    </div>
  );
}
