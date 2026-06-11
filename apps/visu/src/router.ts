import { createRouter } from '@ionic/vue-router';
import { createWebHistory, type RouteRecordRaw } from 'vue-router';
import SkinPage from './pages/SkinPage.vue';

// Routes are derived from the page definitions (A5, Issue #101): one route per
// PageDef, each rendering the generic SkinPage with that page's id. The same
// SkinPage resolves the def → ordered devices + the def's skin, so the ionic and
// terminal pages share one component and differ only by their definition.
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'overview',
    component: SkinPage,
    props: { pageId: 'overview' },
  },
  {
    path: '/terminal',
    name: 'terminal',
    component: SkinPage,
    props: { pageId: 'terminal' },
  },
];

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});
