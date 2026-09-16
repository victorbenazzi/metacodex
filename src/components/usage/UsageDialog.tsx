import { useState } from "react";
import * as RD from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import { CLI_BRAND_ICONS } from "@/components/icons/brand";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Icon } from "@/components/ui/Icon";
import { Select } from "@/components/ui/Select";
import { Gauge, RefreshCw, ArrowUpRight, X } from "@/components/ui/icons";
import { DialogRoot } from "@/components/ui/Dialog";
import { useUsageUiStore } from "@/features/usage/usage.ui.store";
import { useUsageStore } from "@/features/usage/usage.store";
import { useUsageView } from "@/features/usage/useUsageView";
import { USAGE_PROVIDERS } from "@/features/usage/usage.types";
import { CMD, invoke } from "@/lib/ipc";
import { cn } from "@/lib/cn";
import { UsageProviderSummary } from "./UsageProviderSummary";
import { UsageHistory } from "./UsageHistory";
import { UsageTurns } from "./UsageTurns";
import { UsageAccountConnection } from "./UsageAccountConnection";
import { UsageAccountDetails } from "./UsageAccountDetails";
import { UsageBilling } from "./UsageBilling";

export function UsageDialog() {
  const { t, i18n } = useTranslation();
  const open = useUsageUiStore(s => s.open);
  const selected = useUsageUiStore(s => s.selected);
  const select = useUsageUiStore(s => s.select);
  const close = useUsageUiStore(s => s.close);
  const configuring = useUsageStore(s => s.configuring);
  const { snapshot, refreshing, error, projects, liveSessions, now } = useUsageView(open);
  const [projectFilter, setProjectFilter] = useState("all");
  const [linkError, setLinkError] = useState(false);
  const providers = selected ? snapshot.providers.filter(p => p.id === selected) : snapshot.providers;
  const claude = snapshot.providers.find(p => p.id === "claude-code");
  const codex = snapshot.providers.find(p => p.id === "codex-cli");
  const cursor = snapshot.providers.find(p => p.id === "cursor-cli");
  const grok = snapshot.providers.find(p => p.id === "grok");
  const turns = (cursor?.turns ?? []).filter(turn => projectFilter === "all" || turn.projectId === projectFilter);
  const executions = (claude?.sessions ?? []).filter(s => projectFilter === "all" || s.projectId === projectFilter);
  const current = liveSessions.filter(s => (!selected || s.cliId === selected) && (projectFilter === "all" || s.projectId === projectFilter));
  const projectName = (id: string | null) => projects.find(p => p.id === id)?.name ?? t("usage.noProject");
  const currency = new Intl.NumberFormat(i18n.language, { style: "currency", currency: "USD", maximumFractionDigits: 4 });

  return <DialogRoot open={open} onOpenChange={value => { if (!value) close(); }}>
    <RD.Portal>
      <RD.Overlay className="fixed inset-0 z-[100] overlay-scrim data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
      <RD.Content
        onCloseAutoFocus={event => {
          event.preventDefault();
          const target = useUsageUiStore.getState().returnFocusTo;
          const fallback = document.getElementById("usage-sidebar-trigger") ?? document.querySelector<HTMLElement>("[data-usage-focus-fallback]");
          (target?.isConnected ? target : fallback)?.focus({ preventScroll: true });
        }}
        className="fixed left-1/2 top-1/2 z-[101] flex h-[min(760px,90dvh)] w-[min(960px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-hairline surface-raised data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out">
        <header className="flex shrink-0 items-center justify-between gap-12px border-b border-hairline-soft px-20px py-14px">
          <div className="flex min-w-0 items-center gap-10px"><Icon icon={Gauge} size={18} className="shrink-0 text-muted" /><RD.Title className="truncate text-title font-medium">{t("usage.title")}</RD.Title></div>
          <div className="flex shrink-0 items-center gap-8px">
            <Button size="sm" variant="outline" disabled={refreshing || configuring} onClick={() => void useUsageStore.getState().refresh(true)}>
              <Icon icon={RefreshCw} size={13} className={refreshing ? "animate-spin motion-reduce:animate-none" : undefined} />{t(refreshing ? "usage.updating" : "usage.refresh")}
            </Button>
            <RD.Close asChild><IconButton aria-label={t("usage.close")}><Icon icon={X} size={16} /></IconButton></RD.Close>
          </div>
        </header>
        <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] sm:grid-cols-[172px_minmax(0,1fr)] sm:grid-rows-1">
          <nav aria-label={t("usage.agents")} className="flex gap-4px overflow-x-auto border-b border-hairline-soft bg-canvas-soft p-10px sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r">
            <Button variant="ghost" aria-current={!selected ? "page" : undefined} onClick={() => select(null)} className={cn("shrink-0 justify-start gap-8px px-10px font-normal", !selected && "bg-surface-strong")}><Icon icon={Gauge} size={15} />{t("usage.overview")}</Button>
            <span className="hidden px-10px pb-4px pt-18px text-label tracking-label text-muted sm:block">{t("usage.agents")}</span>
            {USAGE_PROVIDERS.map(provider => {
              const Brand = CLI_BRAND_ICONS[provider.id];
              return <Button key={provider.id} variant="ghost" aria-current={selected === provider.id ? "page" : undefined} onClick={() => select(provider.id)} className={cn("shrink-0 justify-start gap-8px px-10px font-normal", selected === provider.id && "bg-surface-strong")}>{Brand && <Brand size={16} />}{provider.name}</Button>;
            })}
            <p className="mt-auto hidden px-10px pt-24px text-label leading-relaxed text-muted sm:block">{t("usage.localFirst")}</p>
          </nav>
          <main key={selected ?? "overview"} className="min-h-0 min-w-0 overflow-y-auto px-20px py-20px sm:px-28px">
            <RD.Description className="mb-8px text-caption leading-relaxed text-muted">{t("usage.description")}</RD.Description>
            {(error || linkError) && <p role="alert" className="my-12px rounded-sm border border-warn/30 bg-warn/5 px-12px py-10px text-caption text-warn">{t(linkError ? "usage.linkError" : "usage.fetchError")}</p>}
            <section aria-label={t("usage.accountLimits")} className="divide-y divide-hairline-soft">
              {providers.map(provider => <div key={provider.id}>
                <UsageProviderSummary provider={provider} now={now} onSelect={!selected ? () => select(provider.id) : undefined} />
                {selected && <>
                  <p className="mb-12px text-caption leading-relaxed text-muted">{t(`usage.source.${provider.id}`)}</p>
                  <Button size="sm" variant="ghost" className="mb-18px -ml-10px text-muted" onClick={() => {
                    setLinkError(false);
                    void invoke(CMD.openExternalUrl, { url: USAGE_PROVIDERS.find(p => p.id === provider.id)!.docs }).catch(() => setLinkError(true));
                  }}>{t("usage.providerDocs")}<Icon icon={ArrowUpRight} size={13} /></Button>
                </>}
              </div>)}
            </section>
            {(selected === "grok" || selected === "cursor-cli") && <UsageAccountConnection key={selected} providerId={selected} account={(selected === "grok" ? grok : cursor)?.account} />}
            {selected === "cursor-cli" && cursor?.account && <UsageAccountDetails account={cursor.account} />}
            {selected === "cursor-cli" && cursor?.billing && <UsageBilling billing={cursor.billing} />}
            {selected === "grok" && grok?.billing && <UsageBilling billing={grok.billing} />}
            {selected === "claude-code" && <section className="mb-20px space-y-12px rounded-md border border-hairline bg-canvas-soft p-16px">
              <h3 className="text-ui font-medium">{t("usage.claudeSetup")}</h3>
              <p className="text-caption leading-relaxed text-body">{t("usage.claudeSetupDescription")}</p>
              <p className="text-caption leading-relaxed text-muted">{t("usage.claudeSetupLimits")}</p>
              <Button size="sm" variant={snapshot.claudeEnabled ? "outline" : "primary"} disabled={configuring || refreshing} onClick={() => void useUsageStore.getState().setCaptureEnabled("claude-code", !snapshot.claudeEnabled)}>{t(configuring ? "common.saving" : snapshot.claudeEnabled ? "usage.disableClaude" : "usage.enableClaude")}</Button>
            </section>}
            {selected === "cursor-cli" && <section className="mb-20px space-y-12px rounded-md border border-hairline bg-canvas-soft p-16px">
              <h3 className="text-ui font-medium">{t("usage.cursorSetup")}</h3>
              <p className="text-caption leading-relaxed text-body">{t(snapshot.cursorEnabled ? "usage.cursorSetupEnabled" : "usage.cursorSetupDescription")}</p>
              {!snapshot.cursorEnabled && <p className="text-caption leading-relaxed text-muted">{t("usage.cursorSetupLimits")}</p>}
              <Button size="sm" variant={snapshot.cursorEnabled ? "outline" : "primary"} disabled={configuring || refreshing} onClick={() => void useUsageStore.getState().setCaptureEnabled("cursor-cli", !snapshot.cursorEnabled)}>{t(configuring ? "common.saving" : snapshot.cursorEnabled ? "usage.disableCursor" : "usage.enableCursor")}</Button>
            </section>}
            {(!selected || selected === "codex-cli") && <UsageHistory days={codex?.dailyUsage ?? []} now={now} />}
            <section className="mt-24px space-y-12px border-t border-hairline-soft pt-20px">
              <div className="flex flex-wrap items-center justify-between gap-10px">
                <h3 className="text-ui font-medium">{t("usage.localSessions")}</h3>
                <Select value={projectFilter} onValueChange={setProjectFilter} ariaLabel={t("usage.projectFilter")} options={[{ value: "all", label: t("usage.allProjects") }, ...projects.map(p => ({ value: p.id, label: p.name }))]} />
              </div>
              <p className="text-caption leading-relaxed text-muted">{t("usage.localSessionsDescription")}</p>
              {current.length ? (
                <ul className="divide-y divide-hairline-soft">
                  {current.map(session => (
                    <li key={session.id} className="flex flex-wrap items-center justify-between gap-8px py-10px text-caption">
                      <span className="min-w-0 truncate text-body">{session.userTitle ?? session.agentTitle ?? session.title}</span>
                      <span className="text-muted">{projectName(session.projectId)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="py-10px text-caption text-muted">{t("usage.noSessions")}</p>}
            </section>
            {(!selected || selected === "cursor-cli") && <UsageTurns turns={turns} projectName={projectName} />}
            {(!selected || selected === "claude-code") && <section className="mt-24px space-y-12px border-t border-hairline-soft pt-20px">
              <h3 className="text-ui font-medium">{t("usage.estimates")}</h3>
              <p className="text-caption leading-relaxed text-muted">{t("usage.estimatesDescription")}</p>
              {executions.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-caption">
                    <thead className="text-muted">
                      <tr className="border-b border-hairline-soft">
                        <th className="pb-10px font-normal">{t("usage.session")}</th>
                        <th className="pb-10px font-normal">{t("usage.model")}</th>
                        <th className="pb-10px text-right font-normal">{t("usage.estimateUsd")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {executions.map((session, i) => (
                        <tr key={`${session.sessionId}:${i}`} className="border-b border-hairline-soft">
                          <td className="py-12px pr-12px">
                            <p className="font-mono text-body">{session.sessionId.slice(0, 8)}</p>
                            <p className="mt-4px text-label text-muted">
                              {projectName(session.projectId)} · {new Intl.DateTimeFormat(i18n.language, { dateStyle: "short", timeStyle: "short" }).format(session.observedAt * 1000)}
                            </p>
                          </td>
                          <td className="pr-12px text-body">{session.model ?? t("usage.unknown")}</td>
                          <td className="text-right font-mono tabular-nums">
                            {session.estimatedCostUsd == null ? t("usage.unknown") : currency.format(session.estimatedCostUsd)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="py-10px text-caption text-muted">{t("usage.noEstimates")}</p>}
            </section>}
          </main>
        </div>
      </RD.Content>
    </RD.Portal>
  </DialogRoot>;
}
