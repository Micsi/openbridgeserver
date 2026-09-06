import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

import de from '../locales/de.json';
import en from '../locales/en.json';
import SettingsPanel from './SettingsPanel.vue';
import {
  useAppSettings,
  reloadAppSettings,
  IDLE_RETURN_HOME_MAX_SECONDS,
  IDLE_RETURN_HOME_MIN_SECONDS,
  IDLE_RETURN_HOME_STORAGE_KEY,
} from './appSettings';

/**
 * app/SettingsPanel — the host settings entry in the shell menu (A7, Issue #144).
 *
 * The panel is a controlled view over the host's app settings: it reads them and
 * calls the setter, it owns nothing. Every visible string is translated, in both
 * shipped locales.
 */
function mountPanel(locale = 'de') {
  const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'de', messages: { de, en } });
  return mount(SettingsPanel, { global: { plugins: [i18n] } });
}

describe('SettingsPanel — idle return to the start page', () => {
  beforeEach(() => {
    localStorage.clear();
    reloadAppSettings();
  });

  it('offers the setting with the current value and shows it is off by default', () => {
    const w = mountPanel();
    const input = w.find('input.settings-idle-seconds');
    expect(input.exists()).toBe(true);
    expect((input.element as HTMLInputElement).value).toBe('0');
    expect(w.find('.settings-idle-state').text()).toBe(de.settings.idleReturnHome.off);
  });

  it('writes an edit through to the persisted host setting', async () => {
    const w = mountPanel();
    const input = w.find('input.settings-idle-seconds');
    await input.setValue('120');
    await input.trigger('change');

    expect(useAppSettings().idleReturnHomeSeconds.value).toBe(120);
    expect(localStorage.getItem(IDLE_RETURN_HOME_STORAGE_KEY)).toBe('120');
    expect(w.find('.settings-idle-state').text()).toContain('120');
  });

  it('clamps an out-of-range entry instead of accepting an absurd timeout', async () => {
    const w = mountPanel();
    const input = w.find('input.settings-idle-seconds');
    await input.setValue('999999');
    await input.trigger('change');

    expect(useAppSettings().idleReturnHomeSeconds.value).toBe(IDLE_RETURN_HOME_MAX_SECONDS);
    // The field shows what was actually stored — never a value the host ignored.
    expect((input.element as HTMLInputElement).value).toBe(String(IDLE_RETURN_HOME_MAX_SECONDS));
  });

  it('clearing the field switches the feature off', async () => {
    useAppSettings().setIdleReturnHomeSeconds(60);
    const w = mountPanel();
    const input = w.find('input.settings-idle-seconds');
    await input.setValue('');
    await input.trigger('change');

    expect(useAppSettings().idleReturnHomeSeconds.value).toBe(0);
    expect(w.find('.settings-idle-state').text()).toBe(de.settings.idleReturnHome.off);
  });

  it('labels and help text come from i18n — in both shipped locales', () => {
    const dePanel = mountPanel('de');
    expect(dePanel.find('.settings-idle-label').text()).toBe(de.settings.idleReturnHome.label);
    const deHelp = dePanel.find('.settings-idle-help').text();
    // The help names the real bounds (interpolated), not a raw {min}/{max}.
    expect(deHelp).toContain(String(IDLE_RETURN_HOME_MIN_SECONDS));
    expect(deHelp).toContain(String(IDLE_RETURN_HOME_MAX_SECONDS));
    expect(deHelp).not.toContain('{');

    const enPanel = mountPanel('en');
    expect(enPanel.find('.settings-idle-label').text()).toBe(en.settings.idleReturnHome.label);
    const enHelp = enPanel.find('.settings-idle-help').text();
    expect(enHelp).toContain(String(IDLE_RETURN_HOME_MAX_SECONDS));
    expect(enHelp).not.toContain('{');

    // The two locales are genuinely different texts, not a copied German string.
    expect(en.settings.idleReturnHome.label).not.toBe(de.settings.idleReturnHome.label);
    expect(enHelp).not.toBe(deHelp);
  });

  it('its heading is not the same word as the nav section already in the menu', () => {
    // `NAV_KEYS` already ships a `settings` SECTION, and the shell menu renders
    // its label right above this panel. Two identical headings one under the
    // other, meaning different things (a page of the visualisation vs. the app's
    // own preferences), is a menu that cannot be read — in either locale.
    //
    // Asserted on the RENDERED heading, not only on the JSON: comparing the two
    // locale values proves the strings differ, but not that the template reaches
    // for the right one. Swapping `t('settings.title')` for `t('shell.nav.settings')`
    // brings the collision straight back with both JSON values untouched.
    expect(de.settings.title).not.toBe(de.shell.nav.settings);
    expect(en.settings.title).not.toBe(en.shell.nav.settings);

    const dePanel = mountPanel('de');
    expect(dePanel.find('.settings-panel__title').text()).toBe(de.settings.title);
    expect(dePanel.find('.settings-panel__title').text()).not.toBe(de.shell.nav.settings);

    const enPanel = mountPanel('en');
    expect(enPanel.find('.settings-panel__title').text()).toBe(en.settings.title);
    expect(enPanel.find('.settings-panel__title').text()).not.toBe(en.shell.nav.settings);
  });

  it('the number field is described by its help text (assistive tech)', () => {
    const w = mountPanel();
    const input = w.find('input.settings-idle-seconds');
    const help = w.find('.settings-idle-help');
    expect(input.attributes('aria-describedby')).toBe(help.attributes('id'));
    expect(input.attributes('id')).toBe(w.find('.settings-idle-label').attributes('for'));
  });
});
