/**
 * Die Backend-Naht des V2-Editors (M5 C1, Issue #168).
 *
 * KEIN neuer Endpunkt: der Editor benutzt genau die Wege, die
 * `obs/api/v1/visu.py` seit jeher anbietet — Baum, Knoten-CRUD, Verschieben,
 * Seiten-Konfiguration, Zielgruppe. Der Token reist wie ueberall in der GUI im
 * `Authorization`-Header (Interceptor in `@/api/client`), nie in einer URL oder
 * einer Query.
 *
 * Jede ID wird kodiert: sie kommt aus dem Backend und ist heute eine UUID, aber
 * eine ungeprueft eingesetzte Fremd-ID ist genau die Stelle, an der eine URL
 * spaeter aufbricht.
 */
import api from '@/api/client'

const id = (value) => encodeURIComponent(value)

export const visuApi = {
  /** Der ganze sichtbare Baum (`VisuNodeSummary[]`, inkl. `kind` und `order`). */
  tree: () => api.get('/visu/tree'),

  /** Die Konfiguration einer Seite (`includes`, `ignore_global_includes`, `popup`, Widgets). */
  getPage: (nodeId) => api.get(`/visu/pages/${id(nodeId)}`),
  savePage: (nodeId, config) => api.put(`/visu/pages/${id(nodeId)}`, config),

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
