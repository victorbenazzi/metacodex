import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Pencil, Eye } from "lucide-react";

import { fsApi } from "@/features/filesystem/filesystem.service";
import { useTabsStore, WORKSPACE_NULL } from "@/components/tabs/tabsStore";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

interface MarkdownPreviewProps {
  tabId: string;
  path: string;
  projectId: string;
  mode: "preview" | "source";
}

export function MarkdownPreview({ tabId, path, projectId, mode }: MarkdownPreviewProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const updateTab = useTabsStore((s) => s.updateTab);

  useEffect(() => {
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
  }, [path]);

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
        <span className="editorial-caps truncate">markdown · {mode}</span>
        <button
          type="button"
          onClick={toggleMode}
          className={cn(
            "inline-flex h-[22px] items-center gap-[6px] rounded-xs px-[8px] text-[11px] text-muted",
            "hover:bg-surface-strong/55 hover:text-ink",
          )}
        >
          <Icon icon={mode === "preview" ? Pencil : Eye} size={11} />
          {mode === "preview" ? "Edit source" : "Show preview"}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {error ? (
          <div className="px-[24px] py-[20px]">
            <p className="editorial-caps text-danger">could not read</p>
            <p className="mt-[4px] font-mono text-[12px] text-body">{error}</p>
          </div>
        ) : content === null ? (
          <p className="px-[24px] py-[20px] font-mono text-[11px] text-muted-soft">loading…</p>
        ) : mode === "source" ? (
          <pre className="whitespace-pre-wrap break-words px-[20px] py-[18px] font-mono text-[12px] leading-[1.55] text-body">
            {content}
          </pre>
        ) : (
          <article
            className="prose prose-neutral mx-auto max-w-[720px] px-[28px] py-[28px] text-[14px] leading-[1.65] text-body"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            <MarkdownBody source={content} />
          </article>
        )}
      </div>
    </div>
  );
}

function MarkdownBody({ source }: { source: string }) {
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
          const inline = p.inline;
          if (inline) {
            return (
              <code className="rounded-xs bg-surface-strong/50 px-[5px] py-[1px] font-mono text-[12px] text-ink">
                {p.children}
              </code>
            );
          }
          return (
            <pre className="my-[16px] overflow-x-auto rounded-sm border border-hairline bg-canvas-soft px-[14px] py-[12px] font-mono text-[12px] leading-[1.5] text-body">
              <code>{p.children}</code>
            </pre>
          );
        },
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
