import { Bot } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import type { AgentAvatar as AvatarData } from "@/features/agent/entities.store";
import { cn } from "@/lib/cn";

const SIZES = {
  sm: { box: 20, emoji: "text-caption", icon: 11 },
  md: { box: 28, emoji: "text-title", icon: 14 },
  lg: { box: 44, emoji: "text-display-s", icon: 20 },
} as const;

/** Identity badge of an agent entity: photo, emoji, or a Bot glyph fallback,
 *  tinted by the entity color when present. */
export function AgentAvatarBadge({
  avatar,
  color,
  size = "md",
  className,
}: {
  avatar?: AvatarData;
  color?: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const s = SIZES[size];
  return (
    <span
      aria-hidden
      style={{ width: s.box, height: s.box, ...(color ? { color } : {}) }}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-pill",
        "border border-hairline-soft bg-surface-1",
        className,
      )}
    >
      {avatar?.kind === "image" ? (
        <img src={avatar.value} alt="" className="h-full w-full object-cover" />
      ) : avatar?.kind === "emoji" ? (
        <span className={cn("leading-none", s.emoji)}>{avatar.value}</span>
      ) : (
        <Icon icon={Bot} size={s.icon} className={color ? undefined : "text-muted"} />
      )}
    </span>
  );
}
