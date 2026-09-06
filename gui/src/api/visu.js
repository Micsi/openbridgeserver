/**
 * Die Backend-Naht des V2-Editors (M5 C1 Issue #168, C2 Issue #169, C3 Issue #170).
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

/** Der ganze sichtbare Baum. `tree` und `getTree` sind DASSELBE (C1/C3 nennen
 *  ihn `tree`, C2 `getTree`) - dieselbe Begruendung wie bei `getPage`/`page`. */
const getTree = () => api.get('/visu/tree')

/** Ein einzelner Knoten (Name, Typ, `kind`, Zugriff). `node` und `getNode` sind
 *  DASSELBE - C1/C3 nennen ihn `node`, der Canvas aus C2 `getNode`. */
const getNode = (nodeId) => api.get(`/visu/nodes/${id(nodeId)}`)

export const visuApi = {
  /** Der ganze sichtbare Baum (`VisuNodeSummary[]`, inkl. `kind` und `order`).
   *  Der Canvas aus C2 liest ihn fuer die LAYER einer Seite: welche Seiten
   *  globale Inkludeseiten sind, steht nur hier (`kind`), und der Baum ist
   *  bereits authz-gefiltert. */
  tree: getTree,
  getTree,

  /** Die Seiten-Konfiguration EINER Seite. `PUT` antwortet mit 204 ohne Koerper. */
  getPage,
  page: getPage,
  savePage: (nodeId, config) => api.put(`/visu/pages/${id(nodeId)}`, config),

  node: getNode,
  getNode,

  createNode: (body) => api.post('/visu/nodes', body),
  updateNode: (nodeId, body) => api.patch(`/visu/nodes/${id(nodeId)}`, body),
  deleteNode: (nodeId) => api.delete(`/visu/nodes/${id(nodeId)}`),
  moveNode: (nodeId, body) => api.put(`/visu/nodes/${id(nodeId)}/move`, body),

  /** Die Zielgruppe einer `user`-Seite (E15). Gesetzt wird sie ueber `updateNode`. */
  nodeUsers: (nodeId) => api.get(`/visu/nodes/${id(nodeId)}/users`),

  /**
   * Der Verlauf einer Seite (M5 C6 Issue #173, E12) - neueste Version zuerst,
   * und ein einzelner frueherer Stand als `PageConfig`.
   *
   * NUR LESEN. Einen Schreibweg fuer den Verlauf gibt es bewusst nicht:
   * „Wiederherstellen" ist `pageVersion(...)` gefolgt von `savePage(...)`, also
   * genau der Weg, den auch der Canvas geht. Ein eigener Restore-Aufruf waere
   * der dritte unabhaengige Schreiber auf `page_config`
   * (Micsi/openbridgeserver#187) - und er kaeme an der Validierung des
   * Seitentyp-Modells vorbei, die im `PUT` sitzt.
   */
  pageVersions: (nodeId) => api.get(`/visu/nodes/${id(nodeId)}/versions`),
  pageVersion: (nodeId, revision) => api.get(`/visu/nodes/${id(nodeId)}/versions/${id(revision)}`),

  /** Einen Teilbaum als Datei ausgeben bzw. wieder einlesen (M5 C6, E18). */
  exportNode: (nodeId) => api.get(`/visu/nodes/${id(nodeId)}/export`),
  importNodes: (body) => api.post('/visu/nodes/import', body),

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
