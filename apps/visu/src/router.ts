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
  {
    // v1.2 media/camera demo (Issue #122): the Medien block via the ionic skin.
    path: '/demo-media',
    name: 'demo-media',
    component: SkinPage,
    props: { pageId: 'demo-media' },
  },
  {
    // Edomi POC (layering W4): the page-owning pixel skin.
    path: '/edomi',
    name: 'edomi',
    component: SkinPage,
    props: { pageId: 'edomi' },
  },
  {
    // #1194: the full-screen camera page a small camera tile links to.
    path: '/camera-full',
    name: 'camera-full',
    component: SkinPage,
    props: { pageId: 'camera-full' },
  },
  {
    // Vorschau-Modus (M5 C4, Issue #171): der Endpunkt, den der V2-Editor in der
    // Admin-GUI als iframe einbettet und per postMessage mit einem Entwurf
    // fuettert. Bewusst ein DYNAMISCHER Import: Empfaenger, PreviewDataSource und
    // deren HTTP-Backend landen in einem eigenen Chunk und werden nur in diesem
    // Modus geladen - das Gast-Bundle waechst nur um diesen Routeneintrag
    // (gemessen; §2.4 „Gast-Bundle waechst nur um den Preview-Empfaenger").
    path: '/preview',
    name: 'preview',
    component: () => import('./preview/PreviewPage.vue'),
  },
];

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});
