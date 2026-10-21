import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./en";
import { fr } from "./fr";

export const UI_LANGUAGES = ["en", "fr"] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];
const STORAGE_KEY = "sentinel.language";

/** The account preference can name a language with no translation yet (Hindi): it shows English. */
export function uiLanguage(preference: string | null | undefined): UiLanguage {
  return preference === "fr" ? "fr" : "en";
}

/** Before sign-in: the last language used on this browser, else the browser's own. */
function initialLanguage(): UiLanguage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return uiLanguage(stored);
  } catch {
    // Storage can be unavailable (private mode).
  }
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en";
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, fr: { translation: fr } },
  lng: initialLanguage(),
  fallbackLng: "en",
  // Synchronous: resources are bundled, so the first render already has its strings.
  initAsync: false,
  // React escapes text already.
  interpolation: { escapeValue: false },
});
document.documentElement.lang = i18n.language;

/** Switches the interface language, sets `<html lang>` and remembers it for the sign-in page. */
export function setUiLanguage(preference: string | null | undefined): void {
  const lang = uiLanguage(preference);
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Non-essential convenience.
  }
  if (i18n.language !== lang) void i18n.changeLanguage(lang);
}

export default i18n;
