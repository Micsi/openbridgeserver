/**
 * Der schmale Zugang des V2-Editors zum Visu-Backend (M5 C2, Issue #169).
 *
 * Genau die vier Aufrufe, die der Canvas braucht: den Knoten (fuer Name und
 * Seitentyp), die Seitenkonfiguration, das Speichern und den Baum. Kein eigener
 * Auflösungs-Endpunkt und keine zweite Datenquelle - die Vorschau bezieht ihre
 * Werte weiterhin selbst ueber die Bruecke (§2.4).
 *
 * Der BAUM ist dazugekommen, weil der Canvas die LAYER einer Seite zeigen und
 * ein-/ausblenden koennen muss (§3, C2-Zeile): welche Seiten globale
 * Inkludeseiten sind, steht nur im Baum (`kind`), und ihre Widgets holt derselbe
 * Seiten-Endpunkt wie die eigene Seite. Der Baum ist bereits authz-gefiltert -
 * eine Seite, die der Autor nicht sehen darf, taucht als Layer gar nicht auf.
 *
 * `PUT /visu/pages/{id}` antwortet mit 204 und ohne Koerper.
 */
import api from './client'

export const visuApi = {
  getNode: (nodeId) => api.get(`/visu/nodes/${nodeId}`),
  getPage: (nodeId) => api.get(`/visu/pages/${nodeId}`),
  savePage: (nodeId, config) => api.put(`/visu/pages/${nodeId}`, config),
  getTree: () => api.get('/visu/tree'),
}

export default visuApi
