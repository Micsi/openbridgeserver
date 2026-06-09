import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { IonicVue } from '@ionic/vue';

import App from './App.vue';
import { router } from './router';
import i18n from './i18n';
import { makeCtx } from './core/ctx';
import { useDeviceStore } from './core/store';
import { MockDataSource } from './core/datasource';

import '@ionic/vue/css/core.css';

// Host → contract seam: inject the i18n translator into the renderer sandbox Ctx
// (CONTRACT v1.1 `Ctx.t`). Renderers receive translated core state text; without
// this the default `ctx` export falls back to the German literals (M1 behaviour).
export const ctx = makeCtx((key, params) => i18n.global.t(key, params ?? {}));

const pinia = createPinia();
const app = createApp(App).use(IonicVue).use(pinia).use(router).use(i18n);

// Seed the host store from the MockDataSource (CONTRACT-v1 §6: the host owns the
// device state). A real KNX/MQTT/obs-REST source plugs in behind the same
// DataSource interface later; the overview page is unchanged (MIGRATION §4).
const store = useDeviceStore(pinia);
void store.init(new MockDataSource());

void router.isReady().then(() => {
  app.mount('#app');
});
