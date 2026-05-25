import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Pencil, Eye } from "lucide-react";
import { useTranslation } from "react-i18next";

import { fsApi } from "@/features/filesystem/filesystem.service";
import { useTabsStore, WORKSPACE_NULL } from "@/components/tabs/tabsStore";
import { EditorTab } from "@/components/editor/EditorTab";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { useThemeStore } from "@/features/theme/theme.store";
import { highlightToHtml } from "@/features/theme/shikiHighlighter";

interface MarkdownPreviewProps {
  tabId: string;
  path: string;
  projectId: string;
  mode: "preview" | "source";
}

export function MarkdownPreview({ tabId, path, projectId, mode }: MarkdownPreviewProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const updateTab = useTabsStore((s) => s.updateTab);

  // Read the file for the rendered preview. Re-runs whenever we flip back to
  // preview so edits saved from the source editor are reflected on disk read.
  useEffect(() => {
    if (mode !== "preview") return;
    let cancelled = false;
    setContent(null);
    setError(null);
    (async () => {
      try {
        const text = await fsApi.readFileText(path);
        if (!cancelled) setContent(text.content);
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, mode]);

  const toggleMode = () => {
    updateTab(projectId ?? WORKSPACE_NULL, tabId, {
      mode: mode === "preview" ? "source" : "preview",
    } as any);
  };

  return (
    <div className="relative flex h-full flex-col bg-canvas">
      <header
        data-tauri-drag-region
        className="flex h-[34px] shrink-0 items-center justify-between border-b border-hairline-soft px-[14px]"
      >
        <span aria-hidden className="flex-1" />
        <button
          type="button"
          onClick={toggleMode}
          className={cn(
            "inline-flex h-[22px] items-center gap-[6px] rounded-xs px-[8px] text-[11px] text-muted",
            "hover:bg-surface-strong/55 hover:text-ink",
          )}
        >
          <Icon icon={mode === "preview" ? Pencil : Eye} size={11} />
          {mode === "preview" ? t("editor.editSource") : t("editor.showPreview")}
        </button>
      </header>

      <div className="relative flex-1 overflow-hidden">
        {/*
          The source editor stays mounted (just hidden in preview) so unsaved
          edits and undo history survive mode toggles. It's a real CodeMirror
          instance via EditorTab — Cmd+S saves, dirty state is tracked.
        */}
        <div
          className="absolute inset-0"
          style={{ display: mode === "source" ? "block" : "none" }}
        >
          <EditorTab tabId={tabId} path={path} projectId={projectId} />
        </div>

        {mode === "preview" ? (
          <div className="absolute inset-0 overflow-y-auto">
            {error ? (
              <div className="px-[24px] py-[20px]">
                <p className="editorial-caps text-danger">{t("editor.couldNotRead")}</p>
                <p className="mt-[4px] font-mono text-[12px] text-body">{error}</p>
              </div>
            ) : content === null ? (
              <p className="px-[24px] py-[20px] font-mono text-[11px] text-muted-soft">
                {t("common.loading")}
              </p>
            ) : (
              <article
                className="prose prose-neutral mx-auto max-w-[720px] px-[28px] py-[28px] text-[14px] leading-[1.65] text-body"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                <MarkdownBody source={content} />
              </article>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MarkdownBody({ source }: { source: string }) {
  // Subscribe so a theme swap re-runs Shiki for every block on the page.
  const theme = useThemeStore((s) => s.theme);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: (p) => (
          <h1
            className="mt-0 font-display text-[34px] font-medium tracking-[-0.01em] text-ink"
            style={{ lineHeight: 1.1 }}
          >
            {p.children}
          </h1>
        ),
        h2: (p) => (
          <h2 className="mt-[28px] font-display text-[22px] font-medium tracking-[-0.005em] text-ink">
            {p.children}
          </h2>
        ),
        h3: (p) => (
          <h3 className="mt-[22px] text-[15px] font-semibold text-ink">{p.children}</h3>
        ),
        p: (p) => <p className="my-[12px] text-body">{p.children}</p>,
        a: (p) => (
          <a
            href={p.href}
            target="_blank"
            rel="noreferrer"
            className="text-ink underline decoration-hairline-strong underline-offset-2 hover:decoration-ink"
          >
            {p.children}
          </a>
        ),
        code: (p: any) => {
          if (p.inline) {
            return (
              <code className="rounded-xs bg-surface-strong/50 px-[5px] py-[1px] font-mono text-[12px] text-ink">
                {p.children}
              </code>
            );
          }
          // Fenced block — react-markdown wraps it in <pre><code> and passes the
          // ```lang on the <code> className as `language-xxx`. We override the
          // <pre> below to a passthrough, then let ShikiCode own both elements.
          const lang = (p.className as string | undefined)?.replace("language-", "");
          const raw = Array.isArray(p.children)
            ? p.children.join("")
            : String(p.children ?? "");
          return <ShikiCode code={raw.replace(/\n$/, "")} lang={lang} themeId={theme.id} />;
        },
        pre: (p: any) => <>{p.children}</>,
        ul: (p) => <ul className="my-[12px] list-disc space-y-[4px] pl-[20px] text-body">{p.children}</ul>,
        ol: (p) => <ol className="my-[12px] list-decimal space-y-[4px] pl-[20px] text-body">{p.children}</ol>,
        blockquote: (p) => (
          <blockquote className="my-[16px] border-l-2 border-hairline-strong pl-[14px] italic text-muted">
            {p.children}
          </blockquote>
        ),
        table: (p) => (
          <div className="my-[16px] overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">{p.children}</table>
          </div>
        ),
        th: (p) => (
          <th className="border-b border-hairline-strong px-[10px] py-[6px] text-left text-[12px] font-semibold text-ink">
            {p.children}
          </th>
        ),
        td: (p) => (
          <td className="border-b border-hairline-soft px-[10px] py-[6px] text-body">{p.children}</td>
        ),
        hr: () => <hr className="my-[24px] border-hairline" />,
      }}
    >
      {source}
    </ReactMarkdown>
  );
}

/**
 * Async-highlighted code block. Renders raw text first (no flash, no layout
 * shift) and swaps in the Shiki HTML once the engine + the requested language +
 * the active theme finish loading. Re-runs on every themeId change so the same
 * block recolors live when the user picks a different palette.
 */
function ShikiCode({ code, lang, themeId }: { code: string; lang: string | undefined; themeId: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    highlightToHtml(code, lang, theme)
      .then((out) => {
        if (!cancelled) setHtml(out);
      })
      .catch(() => {
        // Highlight failure (unknown language, engine init error) → leave the
        // fallback plain `<pre>` rendered below; never crash the preview.
      });
    return () => {
      cancelled = true;
    };
    // theme is captured by ref above; we only care about its id for re-runs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, lang, themeId]);

  if (html) {
    return (
      <div
        className="my-[16px] overflow-x-auto rounded-sm border border-hairline font-mono text-[12px] leading-[1.5] [&_pre]:m-0 [&_pre]:px-[14px] [&_pre]:py-[12px]"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <pre className="my-[16px] overflow-x-auto rounded-sm border border-hairline bg-canvas-soft px-[14px] py-[12px] font-mono text-[12px] leading-[1.5] text-body">
      <code>{code}</code>
    </pre>
  );
}
