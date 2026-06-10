import { createI18n } from 'vue-i18n';
import de from './locales/de.json';
import en from './locales/en.json';
// Skin locale namespaces (`skin.*`) are merged into the app messages so the
// host-injected `ctx.t` actually resolves skin strings — and a locale switch
// (e.g. en) translates them — instead of always falling back to the skin's
// German literals. App vs. skin top-level namespaces are disjoint.
import skinIonicDe from '@obs-visu-skins/ionic/locales/de.json';
import skinIonicEn from '@obs-visu-skins/ionic/locales/en.json';

/**
 * Supported locales.
 * To add a new language: add its JSON file to src/locales/ and import it here.
 */
export const SUPPORTED_LOCALES = [
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'English' },
] as const;

export type LocaleCode = (typeof SUPPORTED_LOCALES)[number]['code'];

/** localStorage key — namespaced to the Visu app, separate from the admin GUI. */
const STORAGE_KEY = 'obs-visu-locale';

function detectLocale(): LocaleCode {
  const stored = localStorage.getItem(STORAGE_KEY) as LocaleCode | null;
  if (stored && SUPPORTED_LOCALES.some((l) => l.code === stored)) return stored;
  const browser = navigator.language.split('-')[0] as LocaleCode;
  if (SUPPORTED_LOCALES.some((l) => l.code === browser)) return browser;
  return 'de';
}

const i18n = createI18n({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: 'de',
  messages: {
    // Only the skin's `skin.*` namespace is merged (its locale files also carry
    // a `$comment` documentation key that must not become a message).
    de: { ...de, skin: skinIonicDe.skin },
    en: { ...en, skin: skinIonicEn.skin },
  },
});

export function setLocale(code: LocaleCode): void {
  i18n.global.locale.value = code;
  localStorage.setItem(STORAGE_KEY, code);
  document.documentElement.lang = code;
}

export default i18n;
