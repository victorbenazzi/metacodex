import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { fsApi } from "@/features/filesystem/filesystem.service";
import { base64ToUint8Array } from "@/lib/base64";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { SendToProjectButton } from "@/components/previews/PreviewToolbar";
import { basename } from "@/lib/path";

// pdfjs worker config. We use the unpkg-hosted worker for dev; a bundled worker
// can be configured later via `pdfjsWorker` import + URL constructor.
async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    // Use the matching version's CDN worker. pdfjs.version is set at runtime.
    pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  }
  return pdfjs;
}

interface PdfPreviewProps {
  path: string;
  preview?: boolean;
}

export function PdfPreview({ path, preview = false }: PdfPreviewProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const docRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setPage(1);
    setPageCount(0);

    (async () => {
      try {
        const file = preview
          ? await fsApi.readPreviewBytes(path)
          : await fsApi.readFileBytes(path);
        if (cancelled) return;
        const data = base64ToUint8Array(file.b64);
        const pdfjs = await loadPdfjs();
        const loadingTask = pdfjs.getDocument({ data });
        const doc = await loadingTask.promise;
        if (cancelled) {
          await doc.destroy();
          return;
        }
        docRef.current = doc;
        setPageCount(doc.numPages);
        await renderPage(1);
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? String(err));
      }
    })();

    return () => {
      cancelled = true;
      const d = docRef.current;
      docRef.current = null;
      if (d) {
        d.destroy?.();
      }
    };
  }, [path, preview]);

  const renderPage = async (n: number) => {
    const doc = docRef.current;
    if (!doc || !canvasRef.current) return;
    const pageObj = await doc.getPage(n);
    const viewport = pageObj.getViewport({ scale: 1.5 });
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await pageObj.render({ canvasContext: ctx, viewport }).promise;
  };

  useEffect(() => {
    if (page) void renderPage(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  return (
    <div className="relative flex h-full flex-col bg-canvas">
      <header
        data-tauri-drag-region
        className="flex h-[34px] shrink-0 items-center justify-between border-b border-hairline-soft px-[14px]"
      >
        <span className="editorial-caps truncate">{t("editor.pdfLabel", { name: basename(path) })}</span>
        <div className="flex items-center gap-[6px]">
          {preview ? <SendToProjectButton path={path} /> : null}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            aria-label={t("editor.previousPage")}
          >
            <Icon icon={ChevronLeft} size={13} />
          </Button>
          <span className="font-mono text-label text-muted">
            {page} / {pageCount || "…"}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setPage((p) => Math.min(pageCount || p, p + 1))}
            disabled={page >= pageCount}
            aria-label={t("editor.nextPage")}
          >
            <Icon icon={ChevronRight} size={13} />
          </Button>
        </div>
      </header>
      <div className="flex flex-1 items-start justify-center overflow-auto bg-canvas-soft p-[24px]">
        {error ? (
          <p className="font-mono text-caption text-danger">{error}</p>
        ) : (
          // bg-white is a deliberate token carve-out: PDF pages are white in
          // both themes, so the placeholder must match the page, not the app
          // surface.
          <canvas ref={canvasRef} className="border border-hairline bg-white" />
        )}
      </div>
    </div>
  );
}
