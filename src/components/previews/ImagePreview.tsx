import { useEffect, useState } from "react";
import { fsApi } from "@/features/filesystem/filesystem.service";
import { basename } from "@/lib/path";

interface ImagePreviewProps {
  path: string;
}

export function ImagePreview({ path }: ImagePreviewProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setError(null);
    (async () => {
      try {
        const f = await fsApi.readFileBytes(path);
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
  }, [path]);

  return (
    <div className="relative flex h-full flex-col bg-canvas">
      <header
        data-tauri-drag-region
        className="flex h-[34px] shrink-0 items-center border-b border-hairline-soft px-[14px]"
      >
        <span className="editorial-caps">image</span>
      </header>
      <div className="flex flex-1 items-center justify-center overflow-auto p-[24px]">
        {error ? (
          <p className="font-mono text-[12px] text-danger">{error}</p>
        ) : dataUrl ? (
          <div className="flex flex-col items-center gap-[14px]">
            <img
              src={dataUrl}
              alt={basename(path)}
              className="max-h-[78vh] max-w-full select-none rounded-sm border border-hairline shadow-none"
              draggable={false}
            />
            <p className="font-mono text-[11px] text-muted-soft">
              {basename(path)} · {formatBytes(size)}
            </p>
          </div>
        ) : (
          <p className="font-mono text-[11px] text-muted-soft">loading…</p>
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
