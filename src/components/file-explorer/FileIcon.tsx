import { ChevronDown, ChevronRight } from "@/components/ui/icons";

import { BrandFileIcon } from "@/components/icons/files/BrandFileIcon";
import { resolveFileIcon } from "@/components/icons/files/fileIconMap";
import { resolveFolderIcon } from "@/components/icons/files/folderIconMap";
import { Icon } from "@/components/ui/Icon";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import { basename } from "@/lib/path";

export function FileIcon({
  isDir,
  isOpen,
  filename,
  size = 12,
  className,
}: {
  isDir: boolean;
  isOpen?: boolean;
  filename: string;
  size?: number;
  className?: string;
}) {
  const colored = useSettingsDataStore(
    (s) => s.settings.interface.explorerIconStyle === "color",
  );

  if (isDir) {
    const FolderIcn = resolveFolderIcon(basename(filename), Boolean(isOpen));
    return <Icon icon={FolderIcn} size={size} className={className} />;
  }
  const entry = resolveFileIcon(filename);
  if (entry.kind === "brand") {
    return (
      <BrandFileIcon
        icon={entry.icon}
        colored={colored}
        size={size}
        className={className}
      />
    );
  }
  return <Icon icon={entry.icon} size={size} className={className} />;
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
