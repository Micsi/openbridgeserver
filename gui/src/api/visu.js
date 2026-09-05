/**
 * Die Backend-Naht des V2-Editors (M5 C1 Issue #168, C3 Issue #170).
 *
 * KEIN neuer Endpunkt: der Editor benutzt genau die Wege, die
 * `obs/api/v1/visu.py` seit jeher anbietet — Baum, Knoten-CRUD, Verschieben,
 * Seiten-Konfiguration, Zielgruppe. Eigene Datei statt eines weiteren Blocks in
 * `client.js`: der Editor waechst in mehreren Teilen (C1-C6) parallel, und ein
 * gemeinsamer Block waere die eine Zeile, an der sich alle stossen. Der
 * Axios-Client bleibt derselbe - dieselbe Basis-URL, derselbe
 * Token-Interceptor, derselbe 401-Weg. Der Token reist wie ueberall in der GUI
 * im `Authorization`-Header, nie in einer URL oder einer Query.
 *
 * Jede ID wird kodiert: sie kommt aus dem Backend und ist heute eine UUID, aber
 * eine ungeprueft eingesetzte Fremd-ID ist genau die Stelle, an der eine URL
 * spaeter aufbricht.
 */
import api from '@/api/client'

const id = (value) => encodeURIComponent(value)

/**
 * Die Seiten-Konfiguration EINER Seite (`includes`, `ignore_global_includes`,
 * `popup`, Widgets).
 *
 * `getPage` und `page` sind DASSELBE - zwei Namen, weil beide Teile denselben
 * Aufruf unabhaengig voneinander gebaut haben (C1: `getPage` im Editor-Store,
 * C3: `page` im Entwurfs-Composable). Statt einen Aufrufer umzubenennen und
 * damit fremdes Beweismaterial anzufassen, steht hier EIN Aufruf unter beiden
 * Namen; ein dritter Weg zum Backend entsteht dadurch nicht.
 */
const getPage = (nodeId) => api.get(`/visu/pages/${id(nodeId)}`)

export const visuApi = {
  /** Der ganze sichtbare Baum (`VisuNodeSummary[]`, inkl. `kind` und `order`). */
  tree: () => api.get('/visu/tree'),

  getPage,
  page: getPage,
  savePage: (nodeId, config) => api.put(`/visu/pages/${id(nodeId)}`, config),

  /** Ein einzelner Knoten (Name, Typ, `kind`, Zugriff). */
  node: (nodeId) => api.get(`/visu/nodes/${id(nodeId)}`),

  createNode: (body) => api.post('/visu/nodes', body),
  updateNode: (nodeId, body) => api.patch(`/visu/nodes/${id(nodeId)}`, body),
  deleteNode: (nodeId) => api.delete(`/visu/nodes/${id(nodeId)}`),
  moveNode: (nodeId, body) => api.put(`/visu/nodes/${id(nodeId)}/move`, body),

  /** Die Zielgruppe einer `user`-Seite (E15). Gesetzt wird sie ueber `updateNode`. */
  nodeUsers: (nodeId) => api.get(`/visu/nodes/${id(nodeId)}/users`),

  /**
   * Die Nutzer, aus denen eine Zielgruppe zusammengestellt wird (E15).
   *
   * Kein Visu-Endpunkt, sondern der bestehende Nutzer-Endpunkt der Admin-API -
   * er steht hier trotzdem, damit der Editor GENAU EINE Backend-Naht hat. Wer
   * den Editor montiert, mockt ein Modul; ohne das griffe jede Montage der
   * Ansicht am echten `axios` vorbei ins Netz.
   */
  usernames: () => api.get('/auth/users'),
}

export default visuApi
