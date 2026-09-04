import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { visuEditorGuard, VISU_EDITOR_ROUTE } from '@/utils/visuEditorAccess'

const routes = [
  { path: '/login', name: 'Login',       component: () => import('@/views/LoginView.vue'),       meta: { public: true } },
  { path: '/',      name: 'Dashboard',   component: () => import('@/views/DashboardView.vue')    },
  { path: '/datapoints',           name: 'DataPoints', component: () => import('@/views/DataPointsView.vue') },
  { path: '/datapoints/:id',       name: 'DataPointDetail', component: () => import('@/views/DataPointDetailView.vue'), props: true },
  { path: '/adapters',             name: 'Adapters',   component: () => import('@/views/AdaptersView.vue')   },
  { path: '/knx-devices',          name: 'KnxDevices', component: () => import('@/views/KnxDevicesView.vue') },
  { path: '/history',              name: 'History',    component: () => import('@/views/HistoryView.vue')    },
  { path: '/ringbuffer',           name: 'RingBuffer', component: () => import('@/views/RingBufferView.vue') },
  { path: '/message-archives',     name: 'MessageArchives', component: () => import('@/views/MessageArchivesView.vue') },
  { path: '/logs',                 name: 'Logs',       component: () => import('@/views/LogView.vue')        },
  { path: '/settings',             name: 'Settings',   component: () => import('@/views/SettingsView.vue')   },
  { path: '/logic',                name: 'Logic',      component: () => import('@/views/LogicView.vue')      },
  // Visu-Editor (M5 C4, Issue #171) — admin-pflichtig, siehe visuEditorGuard.
  { path: VISU_EDITOR_ROUTE,       name: 'VisuEditor', component: () => import('@/views/VisuEditorView.vue'), meta: { admin: true } },
{ path: '/:pathMatch(.*)*',      redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// Auth guard
router.beforeEach(async (to) => {
  const token = localStorage.getItem('access_token')
  if (!to.meta.public && !token) return { name: 'Login' }
  if (to.name === 'Login' && token)  return { name: 'Dashboard' }
  // Admin-pflichtige Routen (Visu-Editor): `is_admin` steht erst nach `loadMe()`
  // fest, und das laeuft sonst erst in App.onMounted — also NACH dieser Wache.
  // Ohne das Nachladen wuerde ein direkt aufgerufener Deep-Link einen Admin
  // faelschlich wegleiten. Nur fuer admin-Routen, damit kein anderer Weg eine
  // zusaetzliche Runde bezahlt.
  if (to.meta.admin) {
    const auth = useAuthStore()
    if (!auth.user) await auth.loadMe()
    return visuEditorGuard(to, auth)
  }
})

export default router
