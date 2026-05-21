import { useEffect } from "react";

import { AppShell } from "@/app/AppShell";
import { KeyboardShortcuts } from "@/app/KeyboardShortcuts";
import { SearchDialog } from "@/components/search/SearchDialog";
import { initThemeListener } from "@/features/theme/theme.store";

export default function App() {
  useEffect(() => {
    initThemeListener();
  }, []);

  return (
    <>
      <KeyboardShortcuts />
      <AppShell />
      <SearchDialog />
    </>
  );
}
