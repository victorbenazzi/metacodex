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

export function makeFileTab(args: {
  projectId: string;
  path: string;
  name: string;
  openInEditMode?: boolean;
}): Tab {
  const id = `f-${args.path}`;
  const kind = fileKindFor(args.name);
  if (kind === "markdown") {
    return {
      id,
      kind: "markdown",
      title: args.name,
      projectId: args.projectId,
      path: args.path,
      mode: args.openInEditMode ? "source" : "preview",
    };
  }
  if (kind === "image") {
    return { id, kind: "image", title: args.name, projectId: args.projectId, path: args.path };
  }
  if (kind === "pdf") {
    return { id, kind: "pdf", title: args.name, projectId: args.projectId, path: args.path };
  }
  return { id, kind: "editor", title: args.name, projectId: args.projectId, path: args.path };
}

export function makePreviewTab(args: { path: string; grantId: string }): Tab {
  const name = basename(args.path);
  const id = `pf-${args.path}`;
  const kind = fileKindFor(name);
  const base = {
    id,
    title: name,
    projectId: null as string | null,
    path: args.path,
    previewGrantId: args.grantId,
  };
  if (kind === "markdown") {
    return { ...base, kind: "markdown", mode: "preview" as const };
  }
  if (kind === "image") {
    return { ...base, kind: "image" };
  }
  if (kind === "pdf") {
    return { ...base, kind: "pdf" };
  }
  return { ...base, kind: "editor" };
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
