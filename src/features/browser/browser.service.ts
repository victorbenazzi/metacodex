import { CMD, invoke } from "@/lib/ipc";

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface DevServer {
  port: number;
  address: string;
  url: string;
  pid?: number;
  command?: string;
  cwd?: string;
  projectId?: string;
  projectName?: string;
  folderName?: string;
}

export interface BrowserHistoryEntry {
  url: string;
  title: string;
  visitedAt: string;
}

export interface BrowserPick {
  url: string;
  selector: string;
  tag: string;
  id: string | null;
  text: string;
  html: string;
  rect: { x: number; y: number; width: number; height: number };
  styles: Record<string, string>;
  component: string | null;
  file: string | null;
  line: number | null;
}

export type BrowserMode = "browse" | "pick" | "draw";

export const browserApi = {
  setBounds(bounds: BrowserBounds): Promise<void> {
    return invoke(CMD.browserSetBounds, { bounds });
  },
  hide(): Promise<void> {
    return invoke(CMD.browserHide);
  },
  navigate(url: string): Promise<void> {
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
  takePick(): Promise<BrowserPick | null> {
    return invoke(CMD.browserTakePick);
  },
  currentUrl(): Promise<string> {
    return invoke(CMD.browserUrl);
  },
  history(): Promise<BrowserHistoryEntry[]> {
    return invoke(CMD.browserHistoryList);
  },
  clearHistory(): Promise<void> {
    return invoke(CMD.browserHistoryClear);
  },
  capture(crop?: BrowserPick["rect"]): Promise<{ path: string }> {
    return invoke(CMD.browserCapture, crop ? { crop } : {});
  },
};
