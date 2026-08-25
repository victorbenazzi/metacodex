import type { BrowserContextDetail, BrowserPick } from "./browser.service";
import { formatVisualContext } from "./sendToAgent";
import { wrapUntrustedPageData } from "./visualDelivery";

function clip(value: string, max: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 3)}...` : compact;
}

function elementIdentity(pick: BrowserPick): string {
  const id = pick.id && pick.id.length <= 64 ? `#${pick.id}` : "";
  const classes = pick.classes
    .filter((name) => name.length <= 48)
    .slice(0, 3)
    .map((name) => `.${name}`)
    .join("");
  return `<${clip(pick.tag, 48)}${id}${classes}>`;
}

function selectorAddsContext(pick: BrowserPick): boolean {
  if (!pick.selector) return false;
  if (pick.id && pick.selector === `#${pick.id}`) return false;
  const identity = `${pick.tag}${pick.id ? `#${pick.id}` : ""}${pick.classes
    .map((name) => `.${name}`)
    .join("")}`;
  return !identity.startsWith(pick.selector);
}

export function formatPickContext(
  pick: BrowserPick,
  screenshotPath: string | null,
  detail: BrowserContextDetail = "compact",
): string {
  const diagnostic = detail === "diagnostic";
  const rect = pick.rect;
  const viewport = pick.viewport;
  return formatVisualContext([
    "Visual context from in-app browser",
    wrapUntrustedPageData([
      `url: ${clip(pick.url, 512)}`,
      `target: ${pick.kind}`,
      `element: ${elementIdentity(pick)}`,
      selectorAddsContext(pick) && pick.selector.length <= 240
        ? `selector: ${pick.selector}`
        : null,
      pick.component
        ? `component: ${clip(pick.component, 96)}${pick.file ? ` (${clip(pick.file, 320)}${pick.line ? `:${pick.line}` : ""})` : ""}`
        : null,
      pick.kind === "text" && pick.text ? `text: ${clip(pick.text, 240)}` : null,
      diagnostic && pick.fullPath && pick.fullPath.length <= 640
        ? `path: ${pick.fullPath}`
        : null,
      diagnostic
        ? `rect: ${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`
        : null,
      diagnostic
        ? `viewport: ${Math.round(viewport.width)}x${Math.round(viewport.height)} @${viewport.dpr}x`
        : null,
      diagnostic && pick.accessibility ? `accessibility: ${clip(pick.accessibility, 480)}` : null,
      diagnostic && pick.styles ? `styles: ${clip(pick.styles, 640)}` : null,
    ]),
    screenshotPath ? `screenshot: ${screenshotPath}` : null,
  ]);
}
