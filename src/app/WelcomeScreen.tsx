import { forwardRef, useEffect, useState } from "react";
import { ChevronDown, FileText, FolderOpen, Github, TerminalSquare } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/ui/Icon";
import { Kbd } from "@/components/ui/Kbd";
import { BackgroundGrain } from "@/components/ui/BackgroundGrain";
import {
  DropdownContent,
  DropdownItem,
  DropdownRoot,
  DropdownTrigger,
} from "@/components/ui/DropdownMenu";
import { cn } from "@/lib/cn";
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
      <BackgroundGrain />

      <div className="relative z-10 mx-auto flex w-full max-w-[760px] flex-col px-[40px] pt-[88px]">
        <span className="editorial-caps">{t("welcome.eyebrow")}</span>

        <div className="mt-[18px] flex items-center gap-[20px]">
          <img
            src="/black-metacodex-icon.png"
            alt=""
            draggable={false}
            className="select-none dark:hidden"
            style={{
              width: "clamp(48px, 6vw, 76px)",
              height: "clamp(48px, 6vw, 76px)",
            }}
          />
          <img
            src="/white-metacodex-icon.png"
            alt=""
            draggable={false}
            className="hidden select-none dark:block"
            style={{
              width: "clamp(48px, 6vw, 76px)",
              height: "clamp(48px, 6vw, 76px)",
            }}
          />
          <h1
            className="font-display tracking-display text-ink"
            style={{ fontSize: "clamp(56px, 7vw, 88px)", lineHeight: 1.02, fontWeight: 500 }}
          >
            metacodex
          </h1>
        </div>

        {/* 18px is a one-off hero size (sanctioned exception to the type scale). */}
        <p className="mt-[12px] max-w-[520px] font-display text-[18px] leading-[1.5] text-body">
          {t("welcome.tagline")}
        </p>

        <div className="mt-[36px] flex items-center gap-[10px]">
          <DropdownRoot>
            <DropdownTrigger asChild>
              <PrimaryAction>
                <Icon icon={FolderOpen} size={14} className="text-on-primary" />
                <span>{t("welcome.openProject")}</span>
                <Icon icon={ChevronDown} size={12} className="ml-[2px] text-on-primary/80" />
              </PrimaryAction>
            </DropdownTrigger>
            <DropdownContent align="start">
              <DropdownItem
                onSelect={onOpenFolder}
                trailing={<Kbd keys={["Mod", "O"]} />}
              >
                <Icon icon={FolderOpen} size={13} className="text-muted" />
                {t("welcome.openProjectMenu.local")}
              </DropdownItem>
              <DropdownItem
                onSelect={onCloneFromGithub}
                trailing={<Kbd keys={["Mod", "Shift", "O"]} />}
              >
                <Icon icon={Github} size={13} className="text-muted" />
                {t("welcome.openProjectMenu.github")}
              </DropdownItem>
            </DropdownContent>
          </DropdownRoot>

          <SecondaryAction onClick={onOpenTerminal}>
            <Icon icon={TerminalSquare} size={14} />
            <span>{t("welcome.openTerminal")}</span>
            <Kbd keys={["Mod", "T"]} className="ml-[6px]" />
          </SecondaryAction>

          <SecondaryAction onClick={onOpenPreviewFile}>
            <Icon icon={FileText} size={14} />
            <span>{t("welcome.openFile")}</span>
          </SecondaryAction>
        </div>

        <div className="mt-[64px] grid max-w-[640px] grid-cols-2 gap-[1px] overflow-hidden rounded-sm border border-hairline bg-hairline">
          <PrincipleCard label={t("welcome.localFirstLabel")} body={t("welcome.localFirstBody")} />
          <PrincipleCard label={t("welcome.realPtyLabel")} body={t("welcome.realPtyBody")} />
        </div>

        <div className="mt-[40px] max-w-[640px]">
          <ResumeCards title={t("resume.titleGlobal")} limit={3} />
        </div>

        <FooterMeta />
      </div>
    </div>
  );
}

const PrimaryAction = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  function PrimaryAction({ children, className, type = "button", ...props }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "press-feedback inline-flex h-[36px] items-center gap-[8px] rounded-sm bg-ink px-[16px] text-ui font-medium text-on-primary",
          "transition-colors duration-fast hover:bg-primary-active focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[3px]",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);

function SecondaryAction({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-[36px] items-center gap-[8px] rounded-sm border border-hairline-strong bg-canvas px-[16px] text-ui font-medium text-ink",
        "transition-colors duration-fast hover:bg-surface-strong/40",
      )}
    >
      {children}
    </button>
  );
}

function PrincipleCard({ label, body }: { label: string; body: string }) {
  return (
    <article className="bg-canvas-soft px-[18px] py-[20px]">
      <header className="editorial-caps text-muted-soft">{label}</header>
      <p className="mt-[10px] text-ui leading-[1.55] text-body">{body}</p>
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
    <footer className="mt-auto flex flex-wrap items-center gap-x-[14px] gap-y-[4px] pb-[28px] pt-[40px] font-mono text-label text-muted-soft">
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
