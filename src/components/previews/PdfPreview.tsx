import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "@/components/ui/icons";
import { useTranslation } from "react-i18next";

import { fsApi } from "@/features/filesystem/filesystem.service";
import { base64ToUint8Array } from "@/lib/base64";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { SendToProjectButton } from "@/components/previews/PreviewToolbar";
import { basename } from "@/lib/path";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  }
  return pdfjs;
}

interface PdfPreviewProps {
  path: string;
  preview?: boolean;
  previewGrantId?: string;
}

export function PdfPreview({ path, preview = false, previewGrantId }: PdfPreviewProps) {
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
        if (preview && !previewGrantId) {
          throw new Error("preview grant missing");
        }
        const file = preview
          ? await fsApi.readPreviewBytes(previewGrantId!)
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
  }, [path, preview, previewGrantId]);

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
        className="flex h-[34px] shrink-0 items-center justify-between border-b border-hairline-soft px-14px"
      >
        <span className="editorial-caps truncate">{t("editor.pdfLabel", { name: basename(path) })}</span>
        <div className="flex items-center gap-6px">
          {preview ? <SendToProjectButton path={path} grantId={previewGrantId} /> : null}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            aria-label={t("editor.previousPage")}
          >
            <Icon icon={ChevronLeft} size={14} />
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
            <Icon icon={ChevronRight} size={14} />
          </Button>
        </div>
      </header>
      <div className="flex flex-1 items-start justify-center overflow-auto bg-canvas-soft p-24px">
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
