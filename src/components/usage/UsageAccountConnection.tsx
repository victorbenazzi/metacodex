import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { useUsageStore } from "@/features/usage/usage.store";
import type { AccountUsage } from "@/features/usage/usage.types";

export function UsageAccountConnection({ providerId, account }: { providerId: "cursor-cli" | "grok"; account?: AccountUsage | null }) {
  const { t } = useTranslation();
  const busy = useUsageStore(s => s.configuring || s.refreshing);
  const [manual, setManual] = useState(false);
  const [cookie, setCookie] = useState("");
  return <section className="mb-20px space-y-12px rounded-md border border-hairline bg-canvas-soft p-16px">
    <h3 className="text-ui font-medium">{t("usage.accountConnection")}</h3>
    {!account && <p className="text-caption leading-relaxed text-body">{t(providerId === "cursor-cli" ? "usage.cursorAccountDescription" : "usage.grokAccountDescription")}</p>}
    {account && <p className="text-caption text-muted">{t(account.source === "sessionCookie" ? "usage.cookieConnected" : "usage.fileConnected")}</p>}
    <div className="flex flex-wrap gap-8px">
      <Button size="sm" variant={account ? "outline" : "primary"} disabled={busy} onClick={() => void useUsageStore.getState().connectAccount(providerId, t(providerId === "cursor-cli" ? "usage.pickCursorFile" : "usage.pickGrokFile"))}>{t(account ? "usage.changeAccountFile" : "usage.connectAccountFile")}</Button>
      {account && <Button size="sm" variant="outline" disabled={busy} onClick={() => { setCookie(""); setManual(false); void useUsageStore.getState().disconnectAccount(providerId); }}>{t("usage.disconnectAccount")}</Button>}
      {providerId === "cursor-cli" && <Button size="sm" variant="ghost" disabled={busy} aria-expanded={manual} onClick={() => { setCookie(""); setManual(!manual); }}>{t(manual ? "common.cancel" : "usage.useCookie")}</Button>}
    </div>
    {manual && <form className="space-y-10px border-t border-hairline-soft pt-12px" onSubmit={event => {
      event.preventDefault();
      const value = cookie; setCookie(""); setManual(false);
      void useUsageStore.getState().connectCursorCookie(value);
    }}>
      <label htmlFor="usage-cursor-cookie" className="block text-caption text-body">{t("usage.cookieLabel")}</label>
      <input id="usage-cursor-cookie" type="password" autoComplete="off" spellCheck={false} value={cookie} onChange={event => setCookie(event.target.value)} maxLength={32768} className="h-32px w-full rounded-sm border border-hairline bg-canvas px-10px text-ui outline-none focus-visible:border-ink" />
      <p className="text-caption leading-relaxed text-muted">{t("usage.cookieHelp")}</p>
      <Button type="submit" size="sm" disabled={busy || !cookie.trim()}>{t("usage.connectSession")}</Button>
    </form>}
    <p className="text-caption leading-relaxed text-muted">{t("usage.accountPrivacy")}</p>
  </section>;
}
