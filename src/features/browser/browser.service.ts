import { CMD, invoke } from "@/lib/ipc";

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface DevServer {
  id: string;
  port: number;
  address: string;
  url: string;
  pid?: number;
  sessionId: string;
  command?: string;
  cwd?: string;
  projectId?: string;
  projectName?: string;
  folderName?: string;
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
  takeCaptureRegion(): Promise<BrowserPick["rect"] | null> {
    return invoke(CMD.browserTakeCaptureRegion);
  },
  currentUrl(): Promise<string> {
    return invoke(CMD.browserUrl);
  },
  capture(crop?: BrowserPick["rect"]): Promise<{ path: string }> {
    return invoke(CMD.browserCapture, crop ? { crop } : {});
  },
};
