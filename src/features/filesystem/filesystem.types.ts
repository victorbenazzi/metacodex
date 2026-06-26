export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  mtimeMs: number;
}

export interface FileMeta {
  size: number;
  mtimeMs: number;
  isDir: boolean;
  isSymlink: boolean;
  mime: string | null;
}

export interface TextFile {
  content: string;
  encoding: "utf-8" | "lossy";
  truncated: boolean;
  size: number;
}

export interface BytesFile {
  b64: string;
  mime: string | null;
  truncated: boolean;
  size: number;
}

export interface PreviewGrant {
  path: string;
  grantId: string;
}
