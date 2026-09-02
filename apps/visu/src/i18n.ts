import { createI18n } from 'vue-i18n';
import de from './locales/de.json';
import en from './locales/en.json';
// Skin locale namespaces (`skin.*`) are merged into the app messages so the
// host-injected `ctx.t` actually resolves skin strings — and a locale switch
// (e.g. en) translates them — instead of always falling back to the skin's
// German literals. App vs. skin top-level namespaces are disjoint, and so are
// the skins among themselves (`skin.ionic` vs. `skin.terminal`), so a shallow
// merge of their `skin` objects is lossless.
//
// EVERY skin the registry ships must be wired here. A skin whose locales are
// missing is not a loud failure — `ctx.t` just silently falls back to the
// literal the renderer passes in, so an English app shows German words. The
// terminal skin sat unwired for exactly that reason.
import skinIonicDe from '@obs-visu-skins/ionic/locales/de.json';
import skinIonicEn from '@obs-visu-skins/ionic/locales/en.json';
import skinTerminalDe from '@obs-visu-skins/terminal/locales/de.json';
import skinTerminalEn from '@obs-visu-skins/terminal/locales/en.json';

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

/**
 * Merge the skins' `skin.*` namespaces into one message subtree.
 *
 * The return type is deliberately a flat `Record<string, unknown>` rather than
 * the inferred literal shape: vue-i18n builds its typed `t()` signature by
 * walking the message tree, and inlining a second deep skin object made that
 * inference blow up (`main.ts` → TS2589 "type instantiation is excessively deep").
 * The app never addresses `skin.*` keys through the typed API anyway — the skins
 * reach them through the host-injected `ctx.t` with plain string keys — so making
 * this subtree opaque costs nothing and keeps the inference shallow.
 */
function skinMessages(...namespaces: object[]): Record<string, unknown> {
  return Object.assign({}, ...namespaces) as Record<string, unknown>;
}

const i18n = createI18n({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: 'de',
  messages: {
    // Only the skins' `skin.*` namespace is merged (their locale files also carry
    // a `$comment` documentation key that must not become a message).
    de: { ...de, skin: skinMessages(skinIonicDe.skin, skinTerminalDe.skin) },
    en: { ...en, skin: skinMessages(skinIonicEn.skin, skinTerminalEn.skin) },
  },
});

export function setLocale(code: LocaleCode): void {
  i18n.global.locale.value = code;
  localStorage.setItem(STORAGE_KEY, code);
  document.documentElement.lang = code;
}

export default i18n;
