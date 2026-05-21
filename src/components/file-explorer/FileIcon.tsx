import {
  Braces,
  ChevronDown,
  ChevronRight,
  File,
  FileCode,
  FileImage,
  FileText,
  FileType2,
  Folder,
  FolderOpen,
  Hash,
  type LucideIcon,
} from "lucide-react";

import { ext } from "@/lib/path";
import { Icon } from "@/components/ui/Icon";

const fileExtMap: Record<string, LucideIcon> = {
  ts: FileCode,
  tsx: FileCode,
  js: FileCode,
  jsx: FileCode,
  mjs: FileCode,
  py: FileCode,
  rs: FileCode,
  go: FileCode,
  rb: FileCode,
  php: FileCode,
  swift: FileCode,
  java: FileCode,
  kt: FileCode,
  c: FileCode,
  cpp: FileCode,
  h: FileCode,
  hpp: FileCode,
  json: Braces,
  yml: Braces,
  yaml: Braces,
  toml: Braces,
  md: FileText,
  mdx: FileText,
  markdown: FileText,
  txt: FileText,
  log: FileText,
  rst: FileText,
  html: FileType2,
  css: Hash,
  scss: Hash,
  pdf: FileType2,
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  gif: FileImage,
  webp: FileImage,
  svg: FileImage,
};

export function FileIcon({
  isDir,
  isOpen,
  filename,
  size = 13,
  className,
}: {
  isDir: boolean;
  isOpen?: boolean;
  filename: string;
  size?: number;
  className?: string;
}) {
  if (isDir) {
    return (
      <Icon icon={isOpen ? FolderOpen : Folder} size={size} className={className} />
    );
  }
  const extension = ext(filename);
  const Icn = fileExtMap[extension] ?? File;
  return <Icon icon={Icn} size={size} className={className} />;
}

export function ChevronIcon({ open, size = 11 }: { open: boolean; size?: number }) {
  return (
    <Icon
      icon={open ? ChevronDown : ChevronRight}
      size={size}
      className="text-muted shrink-0"
    />
  );
}
