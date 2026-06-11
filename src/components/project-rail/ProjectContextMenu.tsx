import { useEffect, useState, type ReactNode } from "react";
import * as RCM from "@radix-ui/react-context-menu";
import { Pencil, Trash2, Paintbrush, FolderOpen, Shapes, ImagePlus, ImageOff } from "lucide-react";
import { useTranslation } from "react-i18next";

import { CMD, invoke } from "@/lib/ipc";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuSub,
} from "@/components/ui/ContextMenu";
import { Icon } from "@/components/ui/Icon";
import { useProjectsStore } from "@/features/projects/project.store";
import { useThemeStore } from "@/features/theme/theme.store";
import {
  tileBackground,
  tileIconColor,
} from "@/features/projects/color";
import {
  PROJECT_PALETTE,
  PROJECT_ICONS,
  type Project,
} from "@/features/projects/project.types";
import { isCustomIcon, pickProjectIcon } from "@/features/projects/customIcon.service";
import { cn } from "@/lib/cn";

interface ProjectContextMenuProps {
  project: Project;
  children: ReactNode;
  onRequestRename: () => void;
  onRequestRemove: () => void;
}

export function ProjectContextMenu({
  project,
  children,
  onRequestRename,
  onRequestRemove,
}: ProjectContextMenuProps) {
  const { t } = useTranslation();
  const updateMeta = useProjectsStore((s) => s.updateMeta);
  const hasCustomIcon = isCustomIcon(project.icon);

  const handlePickIcon = async () => {
    try {
      const uri = await pickProjectIcon(project.path);
      if (uri) await updateMeta(project.id, { icon: uri });
    } catch (e) {
      console.warn("pick project icon failed", e);
    }
  };

  const revealInFinder = async () => {
    try {
      await invoke(CMD.revealInFinder, { path: project.path });
    } catch (e) {
      console.warn("reveal_in_finder failed", e);
    }
  };

  return (
    <ContextMenuRoot>
      <RCM.Trigger asChild>{children}</RCM.Trigger>
      <ContextMenuContent>
        <ContextMenuLabel>{project.name}</ContextMenuLabel>
        <ContextMenuItem onSelect={onRequestRename}>
          <Icon icon={Pencil} size={12} className="text-muted" />
          {t("projectRail.menu.rename")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={revealInFinder}>
          <Icon icon={FolderOpen} size={12} className="text-muted" />
          {t("projectRail.menu.revealInFinder")}
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuSub
          trigger={
            <>
              <Icon icon={Paintbrush} size={12} className="text-muted" />
              <span>{t("projectRail.menu.color")}</span>
              <span
                aria-hidden
                className="ml-[6px] inline-block h-[10px] w-[10px] rounded-pill border border-hairline"
                style={{ backgroundColor: project.color }}
              />
            </>
          }
        >
          <div className="grid grid-cols-4 gap-[8px] p-[10px]">
            {PROJECT_PALETTE.map((entry) => (
              <SwatchButton
                key={entry.hex}
                color={entry.hex}
                selected={project.color === entry.hex}
                onClick={() => updateMeta(project.id, { color: entry.hex })}
              />
            ))}
          </div>
        </ContextMenuSub>

        <ContextMenuSub
          trigger={
            <>
              <Icon icon={Shapes} size={12} className="text-muted" />
              <span>{t("projectRail.menu.icon")}</span>
            </>
          }
        >
          <div className="max-h-[320px] w-[236px] overflow-y-auto p-[8px]">
            <div className="grid grid-cols-5 gap-[6px]">
              {PROJECT_ICONS.map((name) => (
                <IconChoice
                  key={name}
                  name={name}
                  color={project.color}
                  selected={!hasCustomIcon && project.icon === name}
                  onClick={() => updateMeta(project.id, { icon: name })}
                />
              ))}
            </div>

            <div className="my-[8px] h-px bg-hairline-soft" />

            <div className="flex items-center gap-[8px] px-[2px]">
              <CustomImageButton
                imageUri={hasCustomIcon ? project.icon : null}
                ringColor={project.color}
                onClick={handlePickIcon}
              />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="text-label font-medium text-body">
                  {hasCustomIcon ? t("projectRail.menu.changeImage") : t("projectRail.menu.chooseFromComputer")}
                </div>
                <div className="text-[10px] text-muted">
                  {t("projectRail.menu.imageHint")}
                </div>
              </div>
            </div>

            {hasCustomIcon ? (
              <button
                type="button"
                onClick={() => updateMeta(project.id, { icon: "Folder" })}
                className="mt-[8px] flex w-full items-center gap-[6px] rounded-sm px-[6px] py-[5px] text-label text-muted transition-colors hover:bg-surface-strong/40 hover:text-body focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[-1px]"
              >
                <Icon icon={ImageOff} size={12} />
                {t("projectRail.menu.removeImage")}
              </button>
            ) : null}
          </div>
        </ContextMenuSub>

        <ContextMenuSeparator />

        <ContextMenuItem destructive onSelect={onRequestRemove}>
          <Icon icon={Trash2} size={12} />
          {t("projectRail.menu.removeFromApp")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenuRoot>
  );
}

function SwatchButton({
  color,
  selected,
  onClick,
}: {
  color: string;
  selected: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const theme = useThemeStore((s) => s.effective);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("projectRail.menu.useColor", { color })}
      aria-pressed={selected}
      className="relative inline-flex h-[28px] w-[28px] items-center justify-center rounded-md transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[3px]"
      style={{
        backgroundColor: tileBackground(color, {
          theme,
          active: selected,
          hover: false,
        }),
        boxShadow: selected
          ? `0 0 0 2px var(--surface-card), 0 0 0 4px ${color}`
          : "inset 0 0 0 1px var(--hairline)",
      }}
    >
      <span
        aria-hidden
        className="h-[14px] w-[14px] rounded-pill"
        style={{ backgroundColor: color }}
      />
    </button>
  );
}

function IconChoice({
  name,
  color,
  selected,
  onClick,
}: {
  name: string;
  color: string;
  selected: boolean;
  onClick: () => void;
}) {
  const theme = useThemeStore((s) => s.effective);
  return (
    <LazyIcon
      name={name}
      selected={selected}
      onClick={onClick}
      iconColor={tileIconColor(color, theme)}
      ringColor={color}
      tintBg={tileBackground(color, { theme, active: selected, hover: false })}
    />
  );
}

function LazyIcon({
  name,
  iconColor,
  tintBg,
  ringColor,
  selected,
  onClick,
}: {
  name: string;
  iconColor: string;
  tintBg: string;
  ringColor: string;
  selected: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const [Comp, setComp] = useState<any>(null);
  useEffect(() => {
    let cancelled = false;
    import("lucide-react").then((m) => {
      if (cancelled) return;
      const C = (m as any)[name] ?? m.Folder;
      setComp(() => C);
    });
    return () => {
      cancelled = true;
    };
  }, [name]);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("projectRail.menu.useIcon", { name })}
      aria-pressed={selected}
      className={cn(
        "flex h-[30px] w-[30px] items-center justify-center rounded-sm transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[2px]",
        !selected && "hover:bg-surface-strong/40",
      )}
      style={{
        backgroundColor: selected ? tintBg : "transparent",
        boxShadow: selected ? `0 0 0 1.5px ${ringColor}` : undefined,
      }}
    >
      {Comp ? (
        <Comp
          size={14}
          strokeWidth={1.7}
          color={selected ? iconColor : "var(--body)"}
        />
      ) : (
        <span className="h-[14px] w-[14px]" />
      )}
    </button>
  );
}

/**
 * The 1:1 "choose an image" button. Empty state: a dashed tile with an
 * ImagePlus glyph. Active state: the chosen image thumbnail (object-cover) with
 * an accent ring matching the project color — same selection language as the
 * preset icon tiles.
 */
function CustomImageButton({
  imageUri,
  ringColor,
  onClick,
}: {
  imageUri: string | null;
  ringColor: string;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={imageUri ? t("projectRail.menu.changeProjectImage") : t("projectRail.menu.chooseImage")}
      className={cn(
        "flex h-[30px] w-[30px] shrink-0 items-center justify-center overflow-hidden rounded-sm transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[2px]",
        !imageUri && "border border-dashed border-hairline-strong hover:bg-surface-strong/40",
      )}
      style={imageUri ? { boxShadow: `0 0 0 1.5px ${ringColor}` } : undefined}
    >
      {imageUri ? (
        <img src={imageUri} alt="" draggable={false} className="h-full w-full object-contain p-[3px]" />
      ) : (
        <Icon icon={ImagePlus} size={14} className="text-muted" />
      )}
    </button>
  );
}
