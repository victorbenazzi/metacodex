import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Folder } from "lucide-react";
import { useTranslation } from "react-i18next";

import { fsApi } from "@/features/filesystem/filesystem.service";
import type { DirEntry } from "@/features/filesystem/filesystem.types";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

type ChildState = DirEntry[] | "loading" | "error";

interface DirectoryPickerProps {
  /** Project root the tree is anchored at (must be within registered roots). */
  rootPath: string;
  rootLabel: string;
  /** Currently chosen destination folder. */
  selected: string;
  onSelect: (path: string) => void;
}

/**
 * Lazy, in-app directory tree for choosing a destination folder inside a
 * project. Only directories are listed. Keeps its own local cache (no coupling
 * to the explorer store) since it's a transient picker.
 */
export function DirectoryPicker({
  rootPath,
  rootLabel,
  selected,
  onSelect,
}: DirectoryPickerProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([rootPath]));
  const [cache, setCache] = useState<Record<string, ChildState>>({});

  const load = useCallback(async (dir: string) => {
    setCache((c) => ({ ...c, [dir]: "loading" }));
    try {
      const entries = await fsApi.readDir(dir);
      setCache((c) => ({
        ...c,
        [dir]: entries.filter((e) => e.isDir && !e.isSymlink),
      }));
    } catch {
      setCache((c) => ({ ...c, [dir]: "error" }));
    }
  }, []);

  // Re-anchor when the project root changes.
  useEffect(() => {
    setExpanded(new Set([rootPath]));
    setCache({});
    void load(rootPath);
  }, [rootPath, load]);

  const toggle = useCallback(
    (dir: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(dir)) {
          next.delete(dir);
        } else {
          next.add(dir);
          if (!cache[dir]) void load(dir);
        }
        return next;
      });
    },
    [cache, load],
  );

  const renderRow = (path: string, label: string, depth: number) => {
    const isOpen = expanded.has(path);
    const isSel = path === selected;
    const kids = cache[path];
    const indent = 6 + depth * 14;
    return (
      <div key={path}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => onSelect(path)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(path);
            }
          }}
          className={cn(
            "flex h-[26px] cursor-pointer items-center gap-[4px] rounded-xs pr-[8px] text-[12px]",
            isSel
              ? "bg-surface-strong/70 text-ink"
              : "text-body hover:bg-surface-strong/40",
          )}
          style={{ paddingLeft: indent }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggle(path);
            }}
            className="inline-flex h-[16px] w-[16px] shrink-0 items-center justify-center text-muted hover:text-ink"
            aria-label={isOpen ? t("common.collapse") : t("common.expand")}
          >
            <Icon
              icon={ChevronRight}
              size={12}
              className={cn("transition-transform duration-150", isOpen && "rotate-90")}
            />
          </button>
          <Icon icon={Folder} size={13} className="shrink-0 text-muted" />
          <span className="truncate">{label}</span>
        </div>
        {isOpen ? (
          <div>
            {kids === "loading" ? (
              <p
                className="py-[3px] text-[11px] text-muted-soft"
                style={{ paddingLeft: indent + 20 }}
              >
                {t("common.loading")}
              </p>
            ) : Array.isArray(kids) ? (
              kids.map((c) => renderRow(c.path, c.name, depth + 1))
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="max-h-[280px] min-h-[180px] overflow-y-auto rounded-sm border border-hairline bg-canvas py-[4px]">
      {renderRow(rootPath, rootLabel, 0)}
    </div>
  );
}
