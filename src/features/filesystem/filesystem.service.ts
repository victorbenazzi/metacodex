import { CMD, invoke } from "@/lib/ipc";
import type { BytesFile, DirEntry, FileMeta, TextFile } from "./filesystem.types";

export const fsApi = {
  readDir(path: string): Promise<DirEntry[]> {
    return invoke<DirEntry[]>(CMD.readDir, { path });
  },
  stat(path: string): Promise<FileMeta> {
    return invoke<FileMeta>(CMD.stat, { path });
  },
  readFileText(path: string, maxBytes?: number): Promise<TextFile> {
    return invoke<TextFile>(CMD.readFileText, {
      path,
      maxBytes: maxBytes ?? null,
    });
  },
  readFileBytes(path: string, maxBytes?: number): Promise<BytesFile> {
    return invoke<BytesFile>(CMD.readFileBytes, {
      path,
      maxBytes: maxBytes ?? null,
    });
  },
  writeFileText(path: string, content: string): Promise<void> {
    return invoke<void>(CMD.writeFileText, { path, content });
  },
};
