// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorTab } from "./EditorTab";
import { flushAllEditors } from "@/features/editor/editorSavers";
import { collectQuitFailures } from "@/app/hooks/useQuitCoordinator";
import { useEditorStore } from "@/features/editor/editor.store";

const write = vi.hoisted(() => vi.fn(async () => { throw new Error("disk full"); }));
vi.mock("@/features/filesystem/filesystem.service", () => ({ fsApi: {
  readFileText: async () => ({content: "original", encoding: "utf-8", size: 8}),
  writeFileText: write,
} }));
vi.mock("@/features/editor/language-map", () => ({languageFor: async () => [], languageLabel: () => "Text"}));
vi.mock("@/features/git/git.service", () => ({gitApi: {fileHeadContent: async () => "original"}}));
vi.mock("./EditorStatusBar", () => ({EditorStatusBar: () => null}));
vi.mock("./EditorBreadcrumbs", () => ({EditorBreadcrumbs: () => null}));

afterEach(cleanup);

it("blocks quit when the actual mounted editor cannot save its dirty buffer", async () => {
  const {container} = render(<EditorTab tabId="save-test" projectId="p" projectKey="p" path="/tmp/test.txt" />);
  await waitFor(() => expect(container.querySelector(".cm-content")).not.toBeNull());
  const view = EditorView.findFromDOM(container.querySelector(".cm-content") as HTMLElement)!;
  act(() => view.dispatch({changes:{from:0, to:view.state.doc.length, insert:"unsaved work"}}));
  let failures: Awaited<ReturnType<typeof collectQuitFailures>> = [];
  await act(async () => { failures = await collectQuitFailures({editors: flushAllEditors}); });
  expect(write).toHaveBeenCalledWith("/tmp/test.txt", "unsaved work");
  expect(failures).toEqual([{area:"editors", code:"flush_failed", message:"disk full"}]);
  expect(useEditorStore.getState().get("save-test")?.dirty).toBe(true);
  expect(view.state.doc.toString()).toBe("unsaved work");
});
