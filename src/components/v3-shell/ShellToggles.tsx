import { SidePanelToggle } from "@/components/side-panel/SidePanelToggle";
import { LeftSidebarToggle } from "@/components/v3-shell/LeftSidebarToggle";
import { cn } from "@/lib/cn";
import { isMac, isWindows } from "@/lib/platform";

/**
 * Sidebar toggles sit on the window, not in the animating columns. Parking
 * them here keeps each button still while the panels slide underneath.
 */
export function ShellToggles() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex h-[var(--title-bar-h)] items-center">
      <div
        className={cn("pointer-events-auto", isMac ? "ml-[94px]" : "ml-12px")}
      >
        <LeftSidebarToggle />
      </div>
      <div
        className={cn(
          "pointer-events-auto ml-auto",
          isWindows ? "mr-[146px]" : "mr-12px",
        )}
      >
        <SidePanelToggle />
      </div>
    </div>
  );
}
