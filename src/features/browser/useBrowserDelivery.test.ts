// @vitest-environment jsdom
import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useBrowserDelivery } from "./useBrowserDelivery";
import { useProjectsStore } from "@/features/projects/project.store";
import { useTabsStore } from "@/components/tabs/tabsStore";
import { useTerminalStore } from "@/features/terminal/terminal.store";

const mocks = vi.hoisted(() => ({capture: vi.fn<() => Promise<{path:string}>>(), write:vi.fn(async () => {})}));
vi.mock("./browser.service", () => ({browserApi:{capture:mocks.capture,clearDraw:async()=>{},setMode:async()=>{}}}));
vi.mock("@/features/terminal/terminal.service", () => ({ptyApi:{write:mocks.write}}));
vi.mock("@/lib/events", async (original) => ({...await original<object>(), listenWhileMounted: () => () => {}}));
afterEach(cleanup);

it("pins the original session before a deferred native capture", async () => {
  let resolve!: (value:{path:string}) => void;
  mocks.capture.mockReturnValue(new Promise((r) => { resolve=r; }));
  useProjectsStore.setState({activeProjectId:"p"});
  useTabsStore.setState({byProject:{p:{tabs:[],activeTabId:"a"}}});
  useTerminalStore.setState({sessions:Object.fromEntries(["a","b"].map((id)=>[id,{
    id,tabId:id,projectId:"p",kind:"cli",status:"running",cwd:"/tmp",title:id,createdAt:"",
  }]))});
  const {result} = renderHook(useBrowserDelivery);
  let pending!: Promise<void>;
  act(() => {pending=result.current.sendViewport("browse");});
  useTabsStore.setState({byProject:{p:{tabs:[],activeTabId:"b"}}});
  await act(async () => {resolve({path:"/tmp/capture.png"}); await pending;});
  expect(mocks.write).toHaveBeenCalledWith("a", expect.any(String));
  expect(useTabsStore.getState().getBucket("p").activeTabId).toBe("b");
});
