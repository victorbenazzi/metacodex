import { cn } from "@/lib/cn";
import { isMac } from "@/lib/platform";

interface KbdProps {
  keys: string[];
  className?: string;
}

const symbolMap: Record<string, string> = {
  Mod: isMac ? "⌘" : "Ctrl",
  Cmd: "⌘",
  Ctrl: "Ctrl",
  Shift: "⇧",
  Alt: isMac ? "⌥" : "Alt",
  Option: "⌥",
  Enter: "↵",
  Esc: "⎋",
  Tab: "⇥",
  Backspace: "⌫",
};

export function Kbd({ keys, className }: KbdProps) {
  return (
    <span className={cn("inline-flex items-center gap-[3px] text-muted", className)}>
      {keys.map((k, i) => (
        <kbd
          key={i}
          className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-xs border border-hairline bg-canvas-soft px-[5px] font-mono text-label leading-none text-muted"
        >
          {symbolMap[k] ?? k}
        </kbd>
      ))}
    </span>
  );
}
