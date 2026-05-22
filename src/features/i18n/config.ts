import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import ptBR from "./locales/pt-BR.json";

/**
 * Languages offered in Settings → General. `id` is the i18next/BCP-47 tag,
 * `native` is how the language names itself (shown in the selector — never a
 * flag, since a language is not a country).
 */
export const SUPPORTED_LANGUAGES = [
  { id: "en", native: "English" },
  { id: "pt-BR", native: "Português" },
] as const;

export type LanguageId = (typeof SUPPORTED_LANGUAGES)[number]["id"];

/** Mirror of `theme.store`'s persistence: a single localStorage key, read at
 *  module load, written back on every change. No OS detection — English is the
 *  default until the user opts into another language. */
const STORAGE_KEY = "metacodex:language";

export function isLanguageId(value: unknown): value is LanguageId {
  return (
    typeof value === "string" && SUPPORTED_LANGUAGES.some((l) => l.id === value)
  );
}

function readStored(): LanguageId {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (isLanguageId(v)) return v;
  } catch {
    // localStorage may be unavailable in some contexts; fall through
  }
  return "en";
}

function applyHtmlLang(lng: string) {
  if (typeof document !== "undefined") {
    document.documentElement.lang = lng;
  }
}

const initialLanguage = readStored();
applyHtmlLang(initialLanguage);

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    "pt-BR": { translation: ptBR },
  },
  lng: initialLanguage,
  fallbackLng: "en",
  // React already escapes interpolated values — disabling i18next's escaping
  // avoids double-encoding.
  interpolation: { escapeValue: false },
  // Resources are bundled inline, so init is synchronous and there is nothing
  // to suspend on.
  react: { useSuspense: false },
});

// Persist + reflect the choice on the document whenever it changes.
i18n.on("languageChanged", (lng) => {
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    // ignore
  }
  applyHtmlLang(lng);
});

export default i18n;
