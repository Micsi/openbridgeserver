/**
 * Der Seitenbaum als reine Daten (M5 C1, Issue #168).
 *
 * `GET /visu/tree` liefert eine FLACHE Liste; der Editor zeigt eine Hierarchie
 * und laesst darin umordnen und verschieben. Die Entscheidungen dafuer stehen
 * hier als Funktionen ohne Zustand, damit sie einzeln pruefbar sind und nicht
 * erst in einer Montage sichtbar werden.
 *
 * `order` ist tragend: nach ihm stapeln die globalen Inkludeseiten (§2.2, die
 * bewusste Abweichung von Edomis ID-Reihenfolge). Bei Gleichstand entscheidet
 * der Name, damit die Anzeige nicht bei jedem Laden springt.
 */

const orderOf = (node) => (typeof node?.order === 'number' ? node.order : 0)

/** Nach `order`, bei Gleichstand nach Name. Liefert eine NEUE Liste. */
export function sortNodes(nodes) {
  return [...(nodes ?? [])].sort((a, b) => {
    const delta = orderOf(a) - orderOf(b)
    if (delta !== 0) return delta
    return String(a?.name ?? '').localeCompare(String(b?.name ?? ''))
  })
}

/** Die direkten Kinder eines Elternknotens (`null` = Wurzelebene), geordnet. */
export function siblingsOf(nodes, parentId) {
  const wanted = parentId ?? null
  return sortNodes((nodes ?? []).filter((node) => (node.parent_id ?? null) === wanted))
}

/**
 * Die flache Liste als Hierarchie. Jeder Knoten bekommt ein `children`-Array.
 *
 * Ein Knoten, dessen `parent_id` niemanden trifft, haengt an der Wurzel statt zu
 * verschwinden: das Backend kappt `parent_id` auf `null`, sobald der Elternknoten
 * verdeckt ist (§2.1), und eine still fehlende Seite waere die schlechtere Lage.
 * Ein `parent_id`-Zyklus (nur ueber direkten DB-Zugriff herstellbar) laesst die
 * betroffenen Knoten weg, statt die Ansicht endlos laufen zu lassen.
 */
export function buildTree(nodes) {
  const list = nodes ?? []
  const known = new Set(list.map((node) => node.id))
  const wrapped = new Map(list.map((node) => [node.id, { ...node, children: [] }]))
  const roots = []
  for (const node of sortNodes(list)) {
    const parentId = node.parent_id ?? null
    const wrapper = wrapped.get(node.id)
    if (parentId === null || !known.has(parentId)) {
      roots.push(wrapper)
      continue
    }
    wrapped.get(parentId).children.push(wrapper)
  }
  for (const wrapper of wrapped.values()) {
    wrapper.children = sortNodes(wrapper.children)
  }
  return roots
}

/** Der Teilbaum unter `id`, inklusive `id` selbst. */
export function descendantIds(nodes, id) {
  const childrenOf = new Map()
  for (const node of nodes ?? []) {
    const parentId = node.parent_id ?? null
    if (!childrenOf.has(parentId)) childrenOf.set(parentId, [])
    childrenOf.get(parentId).push(node.id)
  }
  const found = new Set([id])
  const pending = [id]
  while (pending.length > 0) {
    const current = pending.pop()
    for (const child of childrenOf.get(current) ?? []) {
      if (found.has(child)) continue
      found.add(child)
      pending.push(child)
    }
  }
  return found
}

/**
 * Darf `id` unter `parentId` wandern?
 *
 * Nein in den eigenen Teilbaum (das Backend haette danach einen Zyklus in
 * `parent_id`), und nein zu einem Ziel, das es gar nicht gibt. Die Wurzel
 * (`null`) ist immer erlaubt.
 */
export function canMoveInto(nodes, id, parentId) {
  if (parentId === null || parentId === undefined) return true
  const list = nodes ?? []
  if (!list.some((node) => node.id === parentId)) return false
  return !descendantIds(list, id).has(parentId)
}

/**
 * Der Tausch mit dem Nachbarn in derselben Ebene: `-1` nach oben, `+1` nach
 * unten. Liefert die beiden neuen `order`-Werte oder `null`, wenn es nichts zu
 * tun gibt (Rand der Ebene, unbekannter Knoten).
 *
 * Tragen beide denselben `order`, waere ein reiner Tausch wirkungslos — dann
 * bekommt der Nachbar einen um eins hoeheren Wert, damit die Bewegung sichtbar
 * wird.
 */
export function neighbourSwap(nodes, id, direction) {
  const node = (nodes ?? []).find((entry) => entry.id === id)
  if (!node) return null
  const level = siblingsOf(nodes, node.parent_id ?? null)
  const index = level.findIndex((entry) => entry.id === id)
  const neighbour = level[index + (direction < 0 ? -1 : 1)]
  if (!neighbour) return null
  const own = orderOf(node)
  const other = orderOf(neighbour)
  if (own === other) {
    return direction < 0
      ? [{ id, order: own }, { id: neighbour.id, order: other + 1 }]
      : [{ id, order: own + 1 }, { id: neighbour.id, order: other }]
  }
  return [
    { id, order: other },
    { id: neighbour.id, order: own },
  ]
}
