import { defineStore } from 'pinia'
import { ref, computed, onScopeDispose } from 'vue'
import { authApi } from '@/api/client'
import { AUTH_TOKEN_REFRESHED_EVENT } from '@/utils/authEvents'

/** Der Schluessel, unter dem das Zugriffstoken im `localStorage` steht. */
const TOKEN_KEY = 'access_token'

export const useAuthStore = defineStore('auth', () => {
  const user    = ref(null)   // { id, username, is_admin, created_at }
  const loading = ref(false)
  const error   = ref(null)

  /**
   * Der Anmeldezustand als REAKTIVER Spiegel des Tokens.
   *
   * WARUM NICHT `computed(() => !!localStorage.getItem(TOKEN_KEY))`: `localStorage`
   * ist keine reaktive Quelle. Ein `computed` darueber wird einmal berechnet und
   * danach von nichts mehr ungueltig gemacht — auf der Anmeldemaske also einmal
   * mit `false`, und dann fuer die ganze Lebensdauer der Seite `false`. Gemessen
   * hat das genau eine Zusage gekostet: ein FRISCH angemeldeter Admin sah den
   * Menuepunkt „Visu-Editor" nicht und wurde von der Router-Wache aufs Dashboard
   * zurueckgeworfen (`canUseVisuEditor` verlangt `isLoggedIn === true`); erst ein
   * vollstaendiger Ladevorgang baute den Store neu auf, und dann stand das Token
   * schon da. Der Fehler war also nur ohne Neuladen sichtbar.
   *
   * Ein `ref` haelt den Stand, und JEDER Schreibweg auf `access_token` meldet ihn:
   *   - `login()`/`logout()` hier im Store,
   *   - die stille Token-Erneuerung in `api/client.js` ueber
   *     {@link AUTH_TOKEN_REFRESHED_EVENT},
   *   - ein anderer Tab ueber das `storage`-Ereignis.
   * Der 401-Rueckfall in `api/client.js` raeumt das Token weg und geht danach
   * ueber `window.location.href` — dort baut sich der Store ohnehin neu auf.
   */
  const token = ref(readToken())
  const isLoggedIn  = computed(() => !!token.value)
  const isAdmin     = computed(() => user.value?.is_admin ?? false)
  const username    = computed(() => user.value?.username ?? '')

  function readToken() {
    try {
      return localStorage.getItem(TOKEN_KEY)
    } catch {
      // Ein Browser ohne Speicherzugriff ist keiner, in dem jemand angemeldet ist.
      return null
    }
  }

  /** Den Spiegel dem Speicher nachziehen — nach jedem fremden Schreibweg. */
  function syncToken() {
    token.value = readToken()
  }

  if (typeof window !== 'undefined') {
    window.addEventListener(AUTH_TOKEN_REFRESHED_EVENT, syncToken)
    window.addEventListener('storage', syncToken)
    // Pinia-Stores leben in einem Effect-Scope; ohne das Abmelden sammelt jede
    // neu erzeugte Pinia-Instanz (Tests, Hot-Reload) einen Horcher an.
    onScopeDispose(() => {
      window.removeEventListener(AUTH_TOKEN_REFRESHED_EVENT, syncToken)
      window.removeEventListener('storage', syncToken)
    })
  }

  async function login(username, password) {
    loading.value = true
    error.value   = null
    try {
      const { data } = await authApi.login(username, password)
      localStorage.setItem(TOKEN_KEY,  data.access_token)
      localStorage.setItem('refresh_token', data.refresh_token)
      syncToken()
      await loadMe()
      return true
    } catch (e) {
      error.value = e.response?.data?.detail ?? 'Login fehlgeschlagen'
      return false
    } finally {
      loading.value = false
    }
  }

  async function loadMe() {
    try {
      const { data } = await authApi.me()
      user.value = data
    } catch {
      user.value = null
    }
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem('refresh_token')
    syncToken()
    user.value = null
  }

  return { user, loading, error, isLoggedIn, isAdmin, username, login, loadMe, logout, syncToken }
})
