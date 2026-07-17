import { useEffect, useState } from "react";
import { ChevronDown, FileText, FolderOpen, Github, TerminalSquare } from "@/components/ui/icons";
import { getVersion } from "@tauri-apps/api/app";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Kbd } from "@/components/ui/Kbd";
import {
  DropdownContent,
  DropdownItem,
  DropdownRoot,
  DropdownTrigger,
} from "@/components/ui/DropdownMenu";
import { MetacodexMark } from "@/components/icons/brand";
import { ResumeCards } from "@/components/resume/ResumeCards";

interface WelcomeScreenProps {
  onOpenFolder: () => void;
  onCloneFromGithub: () => void;
  onOpenTerminal: () => void;
  onOpenPreviewFile: () => void;
}

/**
 * Editorial empty state. Strong typographic hierarchy:
 *   - Fraunces display for "metacodex"
 *   - Inter for body
 *   - Mono for the metadata strip
 * Hairlines only, no shadows, lots of negative space.
 */
export function WelcomeScreen({
  onOpenFolder,
  onCloneFromGithub,
  onOpenTerminal,
  onOpenPreviewFile,
}: WelcomeScreenProps) {
  const { t } = useTranslation();
  return (
    <div className="relative flex h-full w-full overflow-hidden bg-canvas">
      <div className="relative z-10 mx-auto flex w-full max-w-[760px] flex-col px-40px pt-64px">
        <span className="editorial-caps">{t("welcome.eyebrow")}</span>

        <div className="mt-16px flex items-center gap-16px">
          <MetacodexMark size={40} className="shrink-0 select-none text-ink" />
          <h1 className="font-display text-display font-medium text-ink">metacodex</h1>
        </div>

        <p className="mt-12px max-w-[520px] text-content text-body">
          {t("welcome.tagline")}
        </p>

        <div className="mt-32px flex items-center gap-10px">
          <DropdownRoot>
            <DropdownTrigger asChild>
              <Button variant="primary" size="md">
                <Icon icon={FolderOpen} size={14} className="text-on-primary" />
                <span>{t("welcome.openProject")}</span>
                <Icon icon={ChevronDown} size={12} className="ml-[2px] text-on-primary/80" />
              </Button>
            </DropdownTrigger>
            <DropdownContent align="start">
              <DropdownItem
                onSelect={onOpenFolder}
                trailing={<Kbd keys={["Mod", "O"]} />}
              >
                <Icon icon={FolderOpen} size={12} className="text-muted" />
                {t("welcome.openProjectMenu.local")}
              </DropdownItem>
              <DropdownItem
                onSelect={onCloneFromGithub}
                trailing={<Kbd keys={["Mod", "Shift", "O"]} />}
              >
                <Icon icon={Github} size={12} className="text-muted" />
                {t("welcome.openProjectMenu.github")}
              </DropdownItem>
            </DropdownContent>
          </DropdownRoot>

          <Button variant="outline" size="md" onClick={onOpenTerminal}>
            <Icon icon={TerminalSquare} size={14} />
            <span>{t("welcome.openTerminal")}</span>
            <Kbd keys={["Mod", "T"]} className="ml-6px" />
          </Button>

          <Button variant="outline" size="md" onClick={onOpenPreviewFile}>
            <Icon icon={FileText} size={14} />
            <span>{t("welcome.openFile")}</span>
          </Button>
        </div>

        <div className="mt-64px grid max-w-[640px] grid-cols-2 gap-[1px] overflow-hidden rounded-sm border border-hairline bg-hairline">
          <PrincipleCard label={t("welcome.localFirstLabel")} body={t("welcome.localFirstBody")} />
          <PrincipleCard label={t("welcome.realPtyLabel")} body={t("welcome.realPtyBody")} />
        </div>

        <div className="mt-40px max-w-[640px]">
          <ResumeCards title={t("resume.titleGlobal")} limit={3} />
        </div>

        <FooterMeta />
      </div>
    </div>
  );
}

function PrincipleCard({ label, body }: { label: string; body: string }) {
  return (
    <article className="bg-canvas-soft px-18px py-20px">
      <header className="editorial-caps text-muted-soft">{label}</header>
      <p className="mt-10px text-ui leading-[1.55] text-body">{body}</p>
    </article>
  );
}

function FooterMeta() {
  // Real bundle version (the About pane does the same); never hardcode it.
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => undefined);
  }, []);
  return (
    <footer className="mt-auto flex flex-wrap items-center gap-x-14px gap-y-4px pb-28px pt-40px font-mono text-label text-muted-soft">
      {version ? (
        <>
          <span>v{version}</span>
          <span aria-hidden>·</span>
        </>
      ) : null}
      <span>alpha</span>
    </footer>
  );
}
