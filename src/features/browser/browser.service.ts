import { CMD, invoke } from "@/lib/ipc";

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface BrowserPick {
  kind: "element" | "text";
  url: string;
  selector: string;
  tag: string;
  id: string | null;
  classes: string[];
  text: string | null;
  rect: { x: number; y: number; width: number; height: number };
  component: string | null;
  file: string | null;
  line: number | null;
  fullPath: string;
  accessibility: string | null;
  styles: string | null;
  viewport: { width: number; height: number; dpr: number };
}

export type BrowserMode = "browse" | "pick" | "draw" | "capture";
export type BrowserContextDetail = "compact" | "diagnostic";

export interface BrowserNavigation {
  url: string;
  address: string;
}

export const browserApi = {
  setBounds(bounds: BrowserBounds): Promise<void> {
    return invoke(CMD.browserSetBounds, { bounds });
  },
  hide(): Promise<void> {
    return invoke(CMD.browserHide);
  },
  navigate(url: string): Promise<BrowserNavigation> {
    return invoke(CMD.browserNavigate, { url });
  },
  reload(): Promise<void> {
    return invoke(CMD.browserReload);
  },
  goBack(): Promise<void> {
    return invoke(CMD.browserGoBack);
  },
  goForward(): Promise<void> {
    return invoke(CMD.browserGoForward);
  },
  setMode(mode: BrowserMode): Promise<void> {
    return invoke(CMD.browserSetMode, { mode });
  },
  clearDraw(): Promise<void> {
    return invoke(CMD.browserClearDraw);
  },
  capture(crop: BrowserPick["rect"] | undefined, expectedMode: BrowserMode): Promise<{ path: string }> {
    return invoke(CMD.browserCapture, crop ? { crop, expectedMode } : { expectedMode });
  },
};
