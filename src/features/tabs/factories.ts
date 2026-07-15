import type { Tab } from "@/components/tabs/types";
import { fileKindFor } from "@/components/tabs/fileKind";
import type { CliTool } from "@/features/terminal/cli-registry";
import { cliLaunchString } from "@/features/terminal/cli-registry";
import { basename } from "@/lib/path";
import { newId } from "@/lib/idGen";

export function makeTerminalTab(args: {
  projectId: string | null;
  cwd: string;
  title: string;
  prefillCommand?: string;
}): Extract<Tab, { kind: "terminal" }> {
  return {
    id: `t-${newId(10)}`,
    kind: "terminal",
    title: args.title,
    projectId: args.projectId,
    cwd: args.cwd,
    ...(args.prefillCommand ? { prefillCommand: args.prefillCommand } : {}),
  };
}

export function makeCliTab(args: {
  projectId: string | null;
  cwd: string;
  cli: CliTool;
  title?: string;
}): Extract<Tab, { kind: "cli" }> {
  return {
    id: `c-${newId(10)}`,
    kind: "cli",
    title: args.title ?? args.cli.label,
    projectId: args.projectId,
    cwd: args.cwd,
    cliId: args.cli.id,
    launchCommand: cliLaunchString(args.cli),
  };
}

/** Single path-backed tab builder for project files and Preview grants. */
export function makePathTab(args: {
  path: string;
  name: string;
  projectId: string | null;
  previewGrantId?: string;
  /** Markdown source mode when opening an in-project file for edit. */
  openInEditMode?: boolean;
}): Tab {
  const isPreview = args.projectId == null;
  const id = isPreview ? `pf-${args.path}` : `f-${args.path}`;
  const kind = fileKindFor(args.name);
  const base = {
    id,
    title: args.name,
    projectId: args.projectId,
    path: args.path,
    ...(args.previewGrantId ? { previewGrantId: args.previewGrantId } : {}),
  };

  if (kind === "markdown") {
    return {
      ...base,
      kind: "markdown",
      mode: args.openInEditMode && !isPreview ? "source" : "preview",
    };
  }
  if (kind === "image") {
    return { ...base, kind: "image" };
  }
  if (kind === "pdf") {
    return { ...base, kind: "pdf" };
  }
  return { ...base, kind: "editor" };
}

export function makeFileTab(args: {
  projectId: string;
  path: string;
  name: string;
  openInEditMode?: boolean;
}): Tab {
  return makePathTab({
    path: args.path,
    name: args.name,
    projectId: args.projectId,
    openInEditMode: args.openInEditMode,
  });
}

export function makePreviewTab(args: { path: string; grantId: string }): Tab {
  return makePathTab({
    path: args.path,
    name: basename(args.path),
    projectId: null,
    previewGrantId: args.grantId,
  });
}

export function makeDiffTab(args: {
  projectId: string;
  path: string;
  status: string;
}): Extract<Tab, { kind: "diff" }> {
  return {
    id: `diff-${args.path}`,
    kind: "diff",
    title: basename(args.path),
    projectId: args.projectId,
    path: args.path,
    status: args.status,
  };
}

export function isProcessTab(tab: Tab): boolean {
  return tab.kind === "terminal" || tab.kind === "cli";
}
