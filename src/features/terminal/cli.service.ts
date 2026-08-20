import { CMD, invoke } from "@/lib/ipc";

export interface CliDetectResult {
  installed: boolean;
  path: string | null;
  environment: Record<string, string>;
}

export const cliApi = {
  detect(command: string): Promise<CliDetectResult> {
    return invoke<CliDetectResult>(CMD.cliDetect, { command });
  },
};
