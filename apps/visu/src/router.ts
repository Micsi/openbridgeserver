import { createRouter } from '@ionic/vue-router';
import { createWebHistory, type RouteRecordRaw } from 'vue-router';
import OverviewPage from './pages/OverviewPage.vue';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'overview',
    component: OverviewPage,
  },
];

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});
