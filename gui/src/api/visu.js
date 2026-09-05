/**
 * Die Visu-Endpunkte des Editors (M5 C3, Issue #170).
 *
 * Eigene Datei statt eines weiteren Blocks in `client.js`: der Editor waechst in
 * mehreren Teilen (C1-C6) parallel, und ein gemeinsamer Block waere die eine
 * Zeile, an der sich alle stossen. Der Axios-Client bleibt derselbe - also
 * dieselbe Basis-URL, derselbe Token-Interceptor, derselbe 401-Weg. Der Token
 * steht dabei nie in einer URL oder Query, sondern nur im `Authorization`-Kopf,
 * den der Interceptor setzt.
 */
import api from '@/api/client'

export const visuApi = {
  /** Der Knotenbaum (`VisuNodeSummary[]`, vorsortiert nach `order`). */
  tree: () => api.get('/visu/tree'),
  /** Ein Knoten (Name, Typ, `kind`, Zugriff). */
  node: (nodeId) => api.get(`/visu/nodes/${nodeId}`),
  /** Die Seiten-Konfiguration einer PAGE (`PageConfig`). */
  page: (nodeId) => api.get(`/visu/pages/${nodeId}`),
  /** Die Seiten-Konfiguration schreiben (204). */
  savePage: (nodeId, pageConfig) => api.put(`/visu/pages/${nodeId}`, pageConfig),
}

export default visuApi
