import { useEffect } from "react";

import { AppShell } from "@/app/AppShell";
import { KeyboardShortcuts } from "@/app/KeyboardShortcuts";
import { SearchDialog } from "@/components/search/SearchDialog";
import { CommandPalette } from "@/components/command-palette/CommandPalette";
import { DiagnosticLogPanel } from "@/components/diagnostics/DiagnosticLogPanel";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { initThemeListener } from "@/features/theme/theme.store";

export default function App() {
  useEffect(() => {
    initThemeListener();
  }, []);

  // Suppress the WebView's native context menu globally so the app feels
  // native rather than browser-shaped. Region-specific menus (tabs, project
  // tiles, file tree) attach Radix ContextMenu triggers — Radix runs on the
  // child element first and opens its own menu BEFORE the event bubbles to
  // this document-level preventDefault, so both flows coexist.
  //
  // Inputs and contenteditable surfaces are deliberately allowed: they keep
  // the WebView's spellcheck/paste menu, which is the one place the system
  // menu still adds value over our custom UI.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        if (t.isContentEditable) return;
      }
      e.preventDefault();
    };
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  return (
    <ErrorBoundary>
      <TooltipProvider>
        <KeyboardShortcuts />
        <AppShell />
        <SearchDialog />
        <CommandPalette />
        <DiagnosticLogPanel />
      </TooltipProvider>
    </ErrorBoundary>
  );
}
