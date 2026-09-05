/**
 * Der schmale Zugang des V2-Editors zum Visu-Backend (M5 C2, Issue #169).
 *
 * Genau die drei Aufrufe, die der Canvas braucht: den Knoten (fuer Name und
 * Seitentyp), die Seitenkonfiguration und das Speichern. Kein eigener
 * Auflösungs-Endpunkt und keine zweite Datenquelle - die Vorschau bezieht ihre
 * Werte weiterhin selbst ueber die Bruecke (§2.4).
 *
 * `PUT /visu/pages/{id}` antwortet mit 204 und ohne Koerper.
 */
import api from './client'

export const visuApi = {
  getNode: (nodeId) => api.get(`/visu/nodes/${nodeId}`),
  getPage: (nodeId) => api.get(`/visu/pages/${nodeId}`),
  savePage: (nodeId, config) => api.put(`/visu/pages/${nodeId}`, config),
}

export default visuApi
