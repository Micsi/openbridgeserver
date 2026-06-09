import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { IonicVue } from '@ionic/vue';

import App from './App.vue';
import { router } from './router';
import i18n from './i18n';
import { makeCtx } from './core/ctx';

import '@ionic/vue/css/core.css';

// Host → contract seam: inject the i18n translator into the renderer sandbox Ctx
// (CONTRACT v1.1 `Ctx.t`). Renderers receive translated core state text; without
// this the default `ctx` export falls back to the German literals (M1 behaviour).
export const ctx = makeCtx((key, params) => i18n.global.t(key, params ?? {}));

const app = createApp(App).use(IonicVue).use(createPinia()).use(router).use(i18n);

void router.isReady().then(() => {
  app.mount('#app');
});
