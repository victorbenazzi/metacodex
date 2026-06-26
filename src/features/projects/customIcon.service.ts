import i18n from "@/features/i18n/config";
import { fsApi } from "@/features/filesystem/filesystem.service";

/**
 * A project icon (`project.icon`) is either a Lucide icon name (e.g. "Folder")
 * or an embedded image **data URI** chosen by the user. Custom images are stored
 * inline as a downscaled square snapshot, so they never depend on a file path
 * staying put and never need the path-safety check at render time.
 */
export function isCustomIcon(value: string): boolean {
  return value.startsWith("data:");
}

/** Max stored dimension (longest side). The tile renders it much smaller; this
 *  is only a cap so we don't embed a huge bitmap in the project metadata. */
const ICON_MAX_DIM = 128;

/**
 * Open the native file picker (starting in `defaultPath`, so the user can grab
 * their project's own favicon in one step), read the chosen image, and downscale
 * it to a square `ICON_SIZE`px PNG data URI ready to embed in `project.icon`.
 * Returns `null` if the user cancels.
 */
export async function pickProjectIcon(defaultPath: string): Promise<string | null> {
  const file = await fsApi.pickProjectIcon(
    i18n.t("projectRail.menu.pickIconTitle"),
    defaultPath,
  );
  if (!file) return null;
  const mime = file.mime ?? "image/png";
  const sourceUri = `data:${mime};base64,${file.b64}`;
  return await toIconDataUri(sourceUri);
}

/**
 * Downscale `srcUri` so its longest side is at most `ICON_MAX_DIM`, preserving
 * aspect ratio (no crop, no padding) and never upscaling, small favicons stay
 * crisp. The tile renders the result small with `object-contain`, so the whole
 * image stays visible. PNG preserves transparency, and a `data:` source never
 * taints the canvas, so `toDataURL` is allowed (this is why we read bytes
 * through IPC rather than using the `asset:` protocol).
 */
async function toIconDataUri(srcUri: string): Promise<string> {
  const img = new Image();
  img.src = srcUri;
  await img.decode();

  // SVGs can report a 0 intrinsic size; fall back to the cap so the math holds.
  const iw = img.naturalWidth || ICON_MAX_DIM;
  const ih = img.naturalHeight || ICON_MAX_DIM;
  const scale = Math.min(ICON_MAX_DIM / iw, ICON_MAX_DIM / ih, 1);
  const w = Math.max(1, Math.round(iw * scale));
  const h = Math.max(1, Math.round(ih * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return srcUri; // canvas unavailable, fall back to the raw image
  ctx.drawImage(img, 0, 0, w, h);

  return canvas.toDataURL("image/png");
}
