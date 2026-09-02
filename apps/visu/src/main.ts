import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { IonicVue } from '@ionic/vue';

import App from './App.vue';
import { router } from './router';
import i18n from './i18n';
import { installCtxTranslator, makeCtx } from './core/ctx';
import { useDeviceStore } from './core/store';
import { MockDataSource } from './core/datasource';
import { obsDataSourceFromEnv } from './core/obs/obs-datasource';

import '@ionic/vue/css/core.css';
// Terminal (list) skin stylesheet — it scopes the console look to `.t-root`, the
// class the registry hands the page (`skins.terminal.rootClass`). It lives on the
// APP ENTRY rather than on the page component on purpose: this sub-export exists
// only from the terminal skin's contract-1.10 stand, and the page component is
// mounted by the unit tests, which must keep running against whatever skin stand
// the dev link happens to point at (the deliberate cross-repo divergence this
// branch tracks). The app entry is never imported by a test, so the browser gets
// the stylesheet without the page tests taking the cross-repo dependency.
import '@obs-visu-skins/terminal/terminal.css';

// Host → contract seam: inject the i18n translator into the renderer sandbox Ctx
// (CONTRACT v1.1 `Ctx.t`). Renderers receive translated core state text; without
// this the default `ctx` export falls back to the German literals (M1 behaviour).
const translate = (key: string, params?: Record<string, unknown>): string => i18n.global.t(key, params ?? {});
// Hand the translator to the host seam the renderers actually read from. Building
// a translated Ctx and only exporting it left every skin string untranslated.
installCtxTranslator(translate);
export const ctx = makeCtx(translate);

const pinia = createPinia();
const app = createApp(App).use(IonicVue).use(pinia).use(router).use(i18n);

// Seed the host store from a DataSource (CONTRACT-v1 §6: the host owns the
// device state). DEFAULT is the MockDataSource so demo/tests never touch a real
// bus; the real obs-server source plugs in behind the *same* DataSource
// interface ONLY when opted in via env (VITE_USE_OBS=1 / VITE_OBS_API=…), so the
// overview page is unchanged either way (MIGRATION §4, Issue #124).
const store = useDeviceStore(pinia);
void store.init(obsDataSourceFromEnv() ?? new MockDataSource());

void router.isReady().then(() => {
  app.mount('#app');
});
