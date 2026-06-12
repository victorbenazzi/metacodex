import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import {
  entityLifeApi,
  type AgentEntity,
  type MemoryTree,
} from "@/features/agent/entities.store";
import { cn } from "@/lib/cn";

/** Memory tab of an agent profile: file rail + plain markdown editor. */
export function MemorySection({ entity }: { entity: AgentEntity }) {
  const { t } = useTranslation();
  const [tree, setTree] = useState<MemoryTree | null>(null);
  const [selected, setSelected] = useState<string | null>(null); // relPath
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  /** i18n key of the last IPC failure; null = no visible error. */
  const [errorKey, setErrorKey] = useState<string | null>(null);
  /** relPath waiting for the delete confirmation dialog. */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  /** relPath waiting for the "discard unsaved changes" confirmation. */
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setTree(await entityLifeApi.memoryTree(entity.id));
      return true;
    } catch {
      setTree({ index: "", files: [], projects: [] });
      setErrorKey("agent.agents.memory.loadFailed");
      return false;
    }
  }, [entity.id]);

  useEffect(() => {
    let cancelled = false;
    setSelected(null);
    setDirty(false);
    setErrorKey(null);
    setConfirmDelete(null);
    setConfirmDiscard(null);
    void (async () => {
      try {
        const next = await entityLifeApi.memoryTree(entity.id);
        if (!cancelled) setTree(next);
      } catch {
        if (cancelled) return;
        setTree({ index: "", files: [], projects: [] });
        setErrorKey("agent.agents.memory.loadFailed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entity.id]);

  const openFile = async (relPath: string) => {
    setSelected(relPath);
    setDirty(false);
    setErrorKey(null);
    if (relPath === "MEMORY.md") {
      setContent(tree?.index ?? "");
      return;
    }
    try {
      setContent(await entityLifeApi.memoryRead(entity.id, relPath));
    } catch {
      setContent("");
      setErrorKey("agent.agents.memory.loadFailed");
    }
  };

  /** Dirty editor? Ask before discarding; otherwise switch straight away. */
  const requestOpen = (relPath: string) => {
    if (relPath === selected) return;
    if (dirty) {
      setConfirmDiscard(relPath);
      return;
    }
    void openFile(relPath);
  };

  const save = async () => {
    if (!selected || saving) return;
    setSaving(true);
    setErrorKey(null);
    try {
      await entityLifeApi.memoryWrite(entity.id, selected, content);
      setDirty(false);
      await reload();
    } catch {
      setErrorKey("agent.agents.memory.saveFailed");
    } finally {
      setSaving(false);
    }
  };

  const removeFile = async (relPath: string) => {
    setErrorKey(null);
    try {
      await entityLifeApi.memoryDelete(entity.id, relPath);
      if (selected === relPath) setSelected(null);
      await reload();
    } catch {
      setErrorKey("agent.agents.memory.deleteFailed");
    }
  };

  const fileName = (relPath: string | null): string =>
    relPath ? (relPath.split("/").pop() ?? relPath) : "";

  const fileRow = (relPath: string, name: string) => (
    <li key={relPath} className="group flex items-center gap-[6px]">
      <button
        type="button"
        onClick={() => requestOpen(relPath)}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-[8px] rounded-sm px-[8px] py-[5px] text-left text-ui transition-colors duration-fast",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong",
          selected === relPath ? "bg-surface-2 text-ink" : "text-body hover:bg-surface-1",
        )}
      >
        <Icon icon={FileText} size={13} className="shrink-0 text-muted" />
        <span className="truncate">{name}</span>
      </button>
      {relPath !== "MEMORY.md" ? (
        <IconButton
          size="sm"
          aria-label={t("agent.agents.memory.delete")}
          title={t("agent.agents.memory.delete")}
          onClick={() => setConfirmDelete(relPath)}
          className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Icon icon={Trash2} size={12} />
        </IconButton>
      ) : null}
    </li>
  );

  if (!tree) {
    return <p className="text-caption text-muted">{t("agent.agents.memory.loading")}</p>;
  }

  const empty =
    !tree.index.trim() && tree.files.length === 0 && tree.projects.length === 0;

  return (
    <div className="flex flex-col gap-[10px]">
      {errorKey ? (
        <p className="text-caption leading-[1.5] text-danger">{t(errorKey)}</p>
      ) : null}

      <div className="flex items-start gap-[20px]">
        <div className="w-[240px] shrink-0">
          <ul className="flex flex-col gap-[1px]">
            {fileRow("MEMORY.md", t("agent.agents.memory.index"))}
            {tree.files.map((f) => fileRow(f.relPath, f.name))}
          </ul>
          {tree.projects.map((p) => (
            <div key={p.key} className="mt-[12px]">
              <p className="px-[8px] pb-[3px] text-label uppercase tracking-label text-muted-soft">
                {p.key}
              </p>
              <ul className="flex flex-col gap-[1px]">
                {fileRow(`memory/projects/${p.key}/MEMORY.md`, t("agent.agents.memory.index"))}
                {p.files.map((f) => fileRow(f.relPath, f.name))}
              </ul>
            </div>
          ))}
          {empty ? (
            <p className="mt-[10px] px-[8px] text-caption leading-[1.5] text-muted-soft">
              {t("agent.agents.memory.emptyHint")}
            </p>
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          {selected ? (
            <>
              <textarea
                value={content}
                aria-label={t("agent.agents.memory.editorLabel")}
                onChange={(e) => {
                  setContent(e.target.value);
                  setDirty(true);
                }}
                rows={16}
                className="w-full resize-none rounded-md border border-hairline-strong bg-surface-1 px-[12px] py-[10px] font-mono text-caption leading-[1.6] text-ink outline-none transition-colors duration-fast focus:border-ink"
              />
              <div className="mt-[8px] flex items-center justify-between">
                <span className="font-mono text-label text-muted-soft">{selected}</span>
                <Button variant="primary" size="sm" disabled={!dirty || saving} onClick={() => void save()}>
                  {t("agent.agents.memory.save")}
                </Button>
              </div>
            </>
          ) : (
            <p className="pt-[8px] text-caption text-muted">
              {t("agent.agents.memory.pickFile")}
            </p>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
        tone="destructive"
        title={t("agent.agents.memory.deleteConfirmTitle")}
        description={t("agent.agents.memory.deleteConfirmBody", {
          name: fileName(confirmDelete),
        })}
        confirmLabel={t("agent.agents.memory.delete")}
        onConfirm={() => {
          if (confirmDelete) void removeFile(confirmDelete);
        }}
      />

      <ConfirmDialog
        open={confirmDiscard !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDiscard(null);
        }}
        tone="warning"
        title={t("agent.agents.memory.discardTitle")}
        description={t("agent.agents.memory.discardBody", { name: fileName(selected) })}
        confirmLabel={t("agent.agents.memory.discardConfirm")}
        onConfirm={() => {
          if (confirmDiscard) void openFile(confirmDiscard);
        }}
      />
    </div>
  );
}
