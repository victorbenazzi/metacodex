// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useDevServerActions } from "./useDevServerActions";
const mocks = vi.hoisted(()=>({killProcess:vi.fn(),push:vi.fn()}));
vi.mock("@/features/terminal/terminal.service",()=>({ptyApi:{killProcess:mocks.killProcess}}));
vi.mock("@/features/ui/toast.store",()=>({useToastStore:{getState:()=>({push:mocks.push})}}));
it("does not report success and allows retry when a server refuses termination", async()=>{
  mocks.killProcess.mockRejectedValue({code:"Pty",message:"still running"});
  const server={id:"server",sessionId:"s",pid:123,port:3000,address:"127.0.0.1",url:"http://localhost:3000"};
  const servers=[server];
  const {result,unmount}=renderHook(()=>useDevServerActions(servers));
  await act(async()=>{await result.current.stopServer(server);});
  expect(result.current.stoppingServerIds.size).toBe(0);
  expect(mocks.push).toHaveBeenLastCalledWith(expect.objectContaining({tone:"error"}));
  await act(async()=>{await result.current.stopServer(server);});
  expect(mocks.killProcess).toHaveBeenCalledTimes(2);
  unmount();
});
