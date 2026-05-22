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
  deletePath(path: string): Promise<void> {
    return invoke<void>(CMD.deletePath, { path });
  },
  /** Rename within the same parent dir. `newName` is a basename, not a path. Returns the new absolute path. */
  renamePath(path: string, newName: string): Promise<string> {
    return invoke<string>(CMD.renamePath, { path, newName });
  },
  /** Create an empty file (nested name allowed). Returns the new absolute path. */
  createFile(parent: string, name: string): Promise<string> {
    return invoke<string>(CMD.createFile, { parent, name });
  },
  /** Create a directory (nested name allowed). Returns the new absolute path. */
  createDir(parent: string, name: string): Promise<string> {
    return invoke<string>(CMD.createDir, { parent, name });
  },
  /** Move `from` into `toDir`, preserving the basename. Returns the new absolute path. */
  movePath(from: string, toDir: string): Promise<string> {
    return invoke<string>(CMD.movePath, { from, toDir });
  },
};
