import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { FolderOpen, Github } from "@/components/ui/icons";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/ui/Icon";
import { Kbd } from "@/components/ui/Kbd";
import {
  PaletteHint,
  PaletteRow,
  PaletteSection,
  PaletteSheet,
} from "@/components/v3-shell/PaletteSheet";
import { useV3ShellStore } from "@/features/v3-shell/v3Shell.store";
import { useProjectsStore } from "@/features/projects/project.store";
import { fuzzyScore } from "@/lib/fuzzy";

type ProjectPick = {
  kind: "project";
  id: string;
  name: string;
  path: string;
  shortcut?: number;
};

type SourcePick = {
  kind: "source";
  id: "local" | "github";
};

type OpenPick = ProjectPick | SourcePick;

interface OpenProjectModalProps {
  onOpenFolder: () => void;
  onCloneFromGithub: () => void;
}

export function OpenProjectModal({ onOpenFolder, onCloneFromGithub }: OpenProjectModalProps) {
  const { t } = useTranslation();
  const open = useV3ShellStore((s) => s.openProjectOpen);
  const setOpen = useV3ShellStore((s) => s.setOpenProjectOpen);
  const projects = useProjectsStore((s) => s.projects);
  const setActiveProject = useProjectsStore((s) => s.setActive);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const items = useMemo<OpenPick[]>(() => {
    const q = query.trim();
    const ranked = projects
      .map((p, i) => ({
        pick: {
          kind: "project" as const,
          id: p.id,
          name: p.name,
          path: p.path,
          shortcut: q ? undefined : i < 9 ? i + 1 : undefined,
        },
        score: q ? fuzzyScore(q, `${p.name} ${p.path}`) : 0,
      }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => (q ? b.score - a.score : 0))
      .map((x) => x.pick);

    const sources: SourcePick[] = q
      ? (
          [
            { kind: "source", id: "local" },
            { kind: "source", id: "github" },
          ] as SourcePick[]
        ).filter((s) => fuzzyScore(q, sourceHay(s.id, t)) >= 0)
      : [
          { kind: "source", id: "local" },
          { kind: "source", id: "github" },
        ];

    return [...ranked, ...sources];
  }, [projects, query, t]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const choose = (index: number) => {
    const pick = items[index];
    if (!pick) return;
    setOpen(false);
    if (pick.kind === "project") {
      void setActiveProject(pick.id);
      return;
    }
    if (pick.id === "local") onOpenFolder();
    else onCloneFromGithub();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (items.length ? (i + 1) % items.length : 0));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      choose(activeIndex);
      return;
    }
    if (e.key === "Backspace" && query.length === 0) {
      e.preventDefault();
      setOpen(false);
      return;
    }
    const digit = Number(e.key);
    if (
      !query &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      digit >= 1 &&
      digit <= 9
    ) {
      const hit = items.find((it) => it.kind === "project" && it.shortcut === digit);
      if (hit) {
        e.preventDefault();
        choose(items.indexOf(hit));
      }
    }
  };

  const projectItems = items.filter((it): it is ProjectPick => it.kind === "project");
  const sourceItems = items.filter((it): it is SourcePick => it.kind === "source");

  return (
    <PaletteSheet
      open={open}
      onOpenChange={setOpen}
      title={t("v3.openProject.title")}
      placeholder={t("v3.openProject.search")}
      query={query}
      onQueryChange={setQuery}
      onKeyDown={onKeyDown}
      footer={
        <>
          <PaletteHint keys={["↑", "↓"]} label={t("v3.palette.navigate")} />
          <PaletteHint keys={["↵"]} label={t("v3.palette.select")} />
          <PaletteHint keys={["⌫"]} label={t("v3.palette.back")} />
          <PaletteHint keys={["esc"]} label={t("v3.palette.close")} />
        </>
      }
    >
      {items.length === 0 ? (
        <p className="px-10px py-12px text-caption text-muted">{t("v3.palette.nothingFound")}</p>
      ) : (
        <>
          {projectItems.length > 0 ? (
            <>
              <PaletteSection label={t("v3.openProject.projects")} />
              {projectItems.map((pick) => {
                const index = items.indexOf(pick);
                return (
                  <PaletteRow
                    key={pick.id}
                    active={index === activeIndex}
                    icon={<Icon icon={FolderOpen} size={14} />}
                    label={pick.name}
                    description={pick.path}
                    trailing={
                      pick.shortcut ? (
                        <Kbd keys={["Mod", String(pick.shortcut)]} />
                      ) : undefined
                    }
                    onHover={() => setActiveIndex(index)}
                    onClick={() => choose(index)}
                  />
                );
              })}
            </>
          ) : null}
          {sourceItems.length > 0 ? (
            <>
              <PaletteSection label={t("v3.openProject.sources")} />
              {sourceItems.map((pick) => {
                const index = items.indexOf(pick);
                const local = pick.id === "local";
                return (
                  <PaletteRow
                    key={pick.id}
                    active={index === activeIndex}
                    icon={<Icon icon={local ? FolderOpen : Github} size={14} />}
                    label={
                      local ? t("v3.openProject.local") : t("v3.openProject.github")
                    }
                    description={
                      local
                        ? t("v3.openProject.localHint")
                        : t("v3.openProject.githubHint")
                    }
                    trailing={
                      <Kbd keys={local ? ["Mod", "O"] : ["Mod", "Shift", "O"]} />
                    }
                    onHover={() => setActiveIndex(index)}
                    onClick={() => choose(index)}
                  />
                );
              })}
            </>
          ) : null}
        </>
      )}
    </PaletteSheet>
  );
}

function sourceHay(id: "local" | "github", t: (key: string) => string): string {
  if (id === "local") return `${t("v3.openProject.local")} ${t("v3.openProject.localHint")}`;
  return `${t("v3.openProject.github")} ${t("v3.openProject.githubHint")}`;
}
