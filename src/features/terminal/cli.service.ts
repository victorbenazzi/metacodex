import { CMD, invoke } from "@/lib/ipc";

export interface CliDetectResult {
  installed: boolean;
  path: string | null;
}

export const cliApi = {
  detect(command: string): Promise<CliDetectResult> {
    return invoke<CliDetectResult>(CMD.cliDetect, { command });
  },
};
