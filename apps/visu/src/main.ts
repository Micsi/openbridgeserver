import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { IonicVue } from '@ionic/vue';

import App from './App.vue';
import { router } from './router';

import '@ionic/vue/css/core.css';

const app = createApp(App).use(IonicVue).use(createPinia()).use(router);

void router.isReady().then(() => {
  app.mount('#app');
});
