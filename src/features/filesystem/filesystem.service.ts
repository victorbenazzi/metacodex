import { CMD, invoke } from "@/lib/ipc";
import type { BytesFile, DirEntry, FileMeta, PreviewGrant, TextFile } from "./filesystem.types";

export const fsApi = {
  pickPreviewFile(title: string): Promise<PreviewGrant | null> {
    return invoke<PreviewGrant | null>(CMD.pickPreviewFile, { title });
  },
  pickProjectIcon(title: string, defaultPath: string): Promise<BytesFile | null> {
    return invoke<BytesFile | null>(CMD.pickProjectIcon, { title, defaultPath });
  },
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
  createFile(parent: string, name: string): Promise<string> {
    return invoke<string>(CMD.createFile, { parent, name });
  },
  createDir(parent: string, name: string): Promise<string> {
    return invoke<string>(CMD.createDir, { parent, name });
  },
  // Preview mode uses backend-issued grants for files outside project roots.

  readPreviewText(grantId: string, maxBytes?: number): Promise<TextFile> {
    return invoke<TextFile>(CMD.readPreviewText, {
      grantId,
      maxBytes: maxBytes ?? null,
    });
  },
  readPreviewBytes(grantId: string, maxBytes?: number): Promise<BytesFile> {
    return invoke<BytesFile>(CMD.readPreviewBytes, {
      grantId,
      maxBytes: maxBytes ?? null,
    });
  },
  writePreviewText(grantId: string, content: string): Promise<void> {
    return invoke<void>(CMD.writePreviewText, { grantId, content });
  },
  /** Move a previewed file into a project folder ("send to project"). Returns the new absolute path. */
  moveIntoProject(grantId: string, toDir: string): Promise<string> {
    return invoke<string>(CMD.moveIntoProject, { grantId, toDir });
  },
};

export const workspaceFsApi = {
  readDir(projectId: string, path: string): Promise<DirEntry[]> {
    return invoke<DirEntry[]>(CMD.workspaceReadDir, { projectId, path });
  },
  stat(projectId: string, path: string): Promise<FileMeta> {
    return invoke<FileMeta>(CMD.workspaceStat, { projectId, path });
  },
  readFileText(projectId: string, path: string, maxBytes?: number): Promise<TextFile> {
    return invoke<TextFile>(CMD.workspaceReadFileText, {
      projectId,
      path,
      maxBytes: maxBytes ?? null,
    });
  },
  readFileBytes(projectId: string, path: string, maxBytes?: number): Promise<BytesFile> {
    return invoke<BytesFile>(CMD.workspaceReadFileBytes, {
      projectId,
      path,
      maxBytes: maxBytes ?? null,
    });
  },
  writeFileText(projectId: string, path: string, content: string): Promise<void> {
    return invoke<void>(CMD.workspaceWriteFileText, { projectId, path, content });
  },
  createFile(projectId: string, parent: string, name: string): Promise<string> {
    return invoke<string>(CMD.workspaceCreateFile, { projectId, parent, name });
  },
  createDir(projectId: string, parent: string, name: string): Promise<string> {
    return invoke<string>(CMD.workspaceCreateDir, { projectId, parent, name });
  },
};
