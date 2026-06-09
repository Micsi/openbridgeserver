import { createRouter } from '@ionic/vue-router';
import { createWebHistory, type RouteRecordRaw } from 'vue-router';
import HomePage from './pages/HomePage.vue';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: HomePage,
  },
];

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});
