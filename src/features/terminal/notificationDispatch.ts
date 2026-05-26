import { CMD, invoke } from "@/lib/ipc";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import { useTabsStore } from "@/components/tabs/tabsStore";

/**
 * Single funnel for "an agent in tab X wants attention".
 *
 * Decides whether to:
 *   - fire a macOS native banner (gated by `notifications.osNotificationsEnabled`
 *     and the focus-state check controlled by `notifications.notifyWhenFocused`)
 *   - play the chime asset (gated by `notifications.soundEnabled`)
 *
 * The agent-status dot is set separately in the OSC handler / heuristic
 * because we want it always-on, even when the user has disabled banners.
 */
export interface AgentNotificationPayload {
  tabId: string;
  title: string;
  body?: string;
  /** Whether the source explicitly asked for a sound (e.g. OSC 9). The
   *  setting still gates the actual play. */
  sound: boolean;
}

// We synthesize the chime via Web Audio rather than ship an mp3 — keeps the
// bundle slim and lets us tune the timbre by tweaking constants below. The
// envelope is a soft two-tone (E5 → B5) under a quick attack-release.
let audioCtx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (audioCtx) return audioCtx;
  try {
    const Ctor = (window as any).AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
    return audioCtx;
  } catch {
    return null;
  }
}

function playChime() {
  const ctx = getCtx();
  if (!ctx) return;
  // WKWebView can suspend the context on app start until a user gesture; try
  // to resume — if it stays suspended, the play is a no-op (fine — banner is
  // still firing).
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => undefined);
  }
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
  gain.connect(ctx.destination);

  const o1 = ctx.createOscillator();
  o1.type = "sine";
  o1.frequency.setValueAtTime(659.25, now);            // E5
  o1.frequency.exponentialRampToValueAtTime(987.77, now + 0.16); // B5
  o1.connect(gain);
  o1.start(now);
  o1.stop(now + 0.34);
}

function tabIsCurrentlyVisible(tabId: string): boolean {
  if (document.hidden) return false;
  const buckets = useTabsStore.getState().byProject;
  for (const bucket of Object.values(buckets)) {
    if (bucket.activeTabId === tabId) {
      // Found the tab as the active one in some project, but only the
      // currently active project's active tab is actually rendered. We
      // can't introspect the active project from here without coupling
      // back to projects store; the conservative answer is "yes, visible"
      // so we don't double-banner the user. The focus-when-active toggle
      // covers the case where they want banners regardless.
      return true;
    }
  }
  return false;
}

export function dispatchAgentNotification(payload: AgentNotificationPayload) {
  const notifSettings = useSettingsDataStore.getState().settings.notifications;
  const isVisible = tabIsCurrentlyVisible(payload.tabId);

  const shouldBanner =
    notifSettings.osNotificationsEnabled &&
    (notifSettings.notifyWhenFocused || !isVisible);

  const shouldChime = notifSettings.soundEnabled && payload.sound;

  if (shouldBanner) {
    void invoke(CMD.notifyShow, {
      title: payload.title,
      body: payload.body ?? null,
      sound: false, // we handle sound ourselves to share the user setting
    }).catch((err) => console.warn("[notify_show] failed", err));
  }

  if (shouldChime) {
    try {
      playChime();
    } catch {
      // Some WebViews refuse Web Audio without a recent user gesture.
      // Silently swallow — the banner is still firing.
    }
  }
}
