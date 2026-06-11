import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, GitBranch, Plus } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import {
  DropdownContent,
  DropdownItem,
  DropdownRoot,
  DropdownSeparator,
  DropdownTrigger,
} from "@/components/ui/DropdownMenu";
import { gitApi, type BranchInfo } from "@/features/git/git.service";

import { CreateBranchDialog } from "./CreateBranchDialog";

/**
 * Current git branch of the agent's project, with a switcher. Sits on the
 * composer's bottom-right meta line (next to the project name). Selecting a
 * branch checks it out; "Create new branch" branches off HEAD and switches. The
 * picker hides itself when `root` isn't a git repo (no local branches).
 */
export function BranchPicker({ root }: { root: string }) {
  const { t } = useTranslation();
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const reload = useCallback(() => {
    let cancelled = false;
    gitApi
      .branchList(root)
      .then((list) => {
        if (!cancelled) setBranches(list);
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [root]);

  useEffect(() => reload(), [reload]);

  const current = branches.find((b) => b.current);

  const checkout = async (name: string) => {
    if (name === current?.name) return;
    setCheckoutError(null);
    try {
      await gitApi.checkout(root, name);
    } catch (e) {
      // Surface it (dirty tree, conflicts): a silent no-op reads as success.
      const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
      setCheckoutError(msg);
    } finally {
      reload();
    }
  };

  // Not a git repo (or unborn HEAD): nothing to show.
  if (branches.length === 0) return null;

  return (
    <>
      <DropdownRoot onOpenChange={(open) => open && reload()}>
        <DropdownTrigger asChild>
          <button
            type="button"
            aria-label={t("agent.branch.switchLabel")}
            className="inline-flex max-w-[220px] items-center gap-[6px] rounded-sm py-[2px] pl-[2px] pr-[4px] text-[12px] text-muted outline-none transition-colors hover:text-body data-[state=open]:text-body focus-visible:ring-2 focus-visible:ring-ink/15"
          >
            <Icon icon={GitBranch} size={13} strokeWidth={2} className="shrink-0" />
            <span className="truncate font-mono">{current?.name ?? branches[0].name}</span>
            <Icon icon={ChevronDown} size={13} strokeWidth={2} className="shrink-0" />
          </button>
        </DropdownTrigger>
        <DropdownContent align="start" className="max-h-[360px] min-w-[220px] overflow-y-auto">
          {branches.map((b) => (
            <DropdownItem
              key={b.name}
              onSelect={() => void checkout(b.name)}
              trailing={b.current ? <Icon icon={Check} size={13} className="text-ink" /> : null}
            >
              <Icon icon={GitBranch} size={13} strokeWidth={2} className="text-muted" />
              <span className={b.current ? "font-mono text-ink" : "font-mono"}>{b.name}</span>
            </DropdownItem>
          ))}
          <DropdownSeparator />
          <DropdownItem onSelect={() => setCreateOpen(true)}>
            <Icon icon={Plus} size={14} strokeWidth={2} className="text-muted" />
            {t("agent.branch.createNew")}
          </DropdownItem>
        </DropdownContent>
      </DropdownRoot>

      {checkoutError ? (
        <span
          title={checkoutError}
          className="min-w-0 max-w-[260px] truncate text-[11px] text-danger"
        >
          {t("agent.branch.checkoutFailed")}: {checkoutError}
        </span>
      ) : null}

      <CreateBranchDialog
        root={root}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={reload}
      />
    </>
  );
}
