import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import en from "@/locales/en.json";
import es from "@/locales/es.json";
import { KV_PREFIX, kvGet, kvRemove, kvSet } from "@/lib/kv";

export const SUPPORTED_LOCALES = ["es", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "es";

const LOCALE_KEY = "locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Keep <html lang> and dir in sync with the active language. */
function applyDocumentLanguage(lng: string) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lng;
  document.documentElement.dir = i18n.dir(lng);
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { es: { translation: es }, en: { translation: en } },
    supportedLngs: SUPPORTED_LOCALES,
    nonExplicitSupportedLngs: true,
    load: "languageOnly",
    fallbackLng: DEFAULT_LOCALE,
    interpolation: { escapeValue: false },
    detection: {
      // An explicit choice from Settings wins; otherwise follow the browser.
      // Nothing is cached automatically, so a browser language change is still picked up.
      order: ["localStorage", "navigator"],
      lookupLocalStorage: `${KV_PREFIX}${LOCALE_KEY}`,
      caches: [],
    },
  });

i18n.on("languageChanged", applyDocumentLanguage);
applyDocumentLanguage(i18n.resolvedLanguage ?? DEFAULT_LOCALE);

/** The locale chosen in Settings, or `null` when following the browser. */
export function getLocaleOverride(): Locale | null {
  const v = kvGet(LOCALE_KEY);
  return isLocale(v) ? v : null;
}

/** Settings: `null` = follow the browser. */
export function setLocaleOverride(locale: Locale | null) {
  if (locale) {
    kvSet(LOCALE_KEY, locale);
    void i18n.changeLanguage(locale);
  } else {
    kvRemove(LOCALE_KEY);
    const browser = (globalThis.navigator?.language ?? DEFAULT_LOCALE).slice(0, 2);
    void i18n.changeLanguage(isLocale(browser) ? browser : DEFAULT_LOCALE);
  }
}

export default i18n;
