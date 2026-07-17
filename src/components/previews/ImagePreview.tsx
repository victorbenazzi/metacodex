import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fsApi } from "@/features/filesystem/filesystem.service";
import { SendToProjectButton } from "@/components/previews/PreviewToolbar";
import { basename } from "@/lib/path";

interface ImagePreviewProps {
  path: string;
  preview?: boolean;
  previewGrantId?: string;
}

export function ImagePreview({ path, preview = false, previewGrantId }: ImagePreviewProps) {
  const { t } = useTranslation();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setError(null);
    (async () => {
      try {
        if (preview && !previewGrantId) {
          throw new Error("preview grant missing");
        }
        const f = preview
          ? await fsApi.readPreviewBytes(previewGrantId!)
          : await fsApi.readFileBytes(path);
        if (cancelled) return;
        const mime = f.mime ?? "application/octet-stream";
        setDataUrl(`data:${mime};base64,${f.b64}`);
        setSize(f.size);
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, preview, previewGrantId]);

  return (
    <div className="relative flex h-full flex-col bg-canvas">
      <header
        data-tauri-drag-region
        className="flex h-[34px] shrink-0 items-center justify-between border-b border-hairline-soft px-14px"
      >
        <span className="editorial-caps">{t("editor.image")}</span>
        {preview ? <SendToProjectButton path={path} grantId={previewGrantId} /> : null}
      </header>
      <div className="flex flex-1 items-center justify-center overflow-auto p-24px">
        {error ? (
          <p className="font-mono text-caption text-danger">{error}</p>
        ) : dataUrl ? (
          <div className="flex flex-col items-center gap-14px">
            <img
              src={dataUrl}
              alt={basename(path)}
              className="max-h-[78vh] max-w-full select-none rounded-sm border border-hairline shadow-none"
              draggable={false}
            />
            <p className="font-mono text-label text-muted-soft">
              {basename(path)} · {formatBytes(size)}
            </p>
          </div>
        ) : (
          <p className="font-mono text-label text-muted-soft">{t("common.loading")}</p>
        )}
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
