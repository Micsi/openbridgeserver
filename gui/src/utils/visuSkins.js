/**
 * Skin bzw. Theme pro Seite (M5 C1, Issue #168 — Messlatte E19).
 *
 * ZWEI EHRLICHE GRENZEN, beide gepinnt in `tests/utils/visuSkins.spec.js`:
 *
 * 1. DIE SCHLUESSEL SIND EINE KOPIE. Die Admin-GUI liegt nicht im pnpm-Workspace
 *    der Visu (siehe Kopf von `useVisuPreviewBridge.js`) und kann
 *    `apps/visu/src/skin-host/skins.ts` nicht importieren — die Registry zieht
 *    die Skin-Pakete selbst herein. Die Kopie ist deshalb gebunden: die Spec
 *    liest die Registry-Quelle und vergleicht die Schluessel. Laufen sie
 *    auseinander, faellt der Test, nicht die Vorschau (`resolveSkin` wirft dort
 *    hart, es gibt bewusst keinen stillen Ersatz-Skin).
 *
 * 2. DIE WAHL LIEGT HEUTE IM BROWSER, NICHT IM BACKEND. `PageConfig`
 *    (`obs/models/visu.py`) hat kein Feld fuer den Skin, und `save_page`
 *    schreibt `config.model_dump_json()` — ein zusaetzliches Feld faellt still
 *    weg. Teil C1 darf `obs/` nicht anfassen (Teil A ist durch), also merkt sich
 *    der Editor die Wahl je SEITE lokal. Das erfuellt E19 („die Wahl ueberlebt
 *    den Reload") und ist per Seite getrennt — es ist aber NICHT dasselbe wie
 *    „steht im GET": ein anderer Browser sieht die Vorgabe. Der dauerhafte Platz
 *    waere `PageConfig.skin` und gehoert Teil A.
 */

/** Die Schluessel der Skin-Registry der Visu, in ihrer Reihenfolge. */
export const VISU_SKIN_KEYS = Object.freeze(['ionic', 'terminal', 'edomi'])

/**
 * Die Vorgabe. `edomi` ist der einzige seitenbesitzende Skin (§2.5) und damit
 * der realistische Fall fuer Seitentypen, Layering und Popups.
 */
export const DEFAULT_VISU_SKIN = 'edomi'

/** Kennt die Vorschau diesen Skin? */
export function isKnownSkin(key) {
  return typeof key === 'string' && VISU_SKIN_KEYS.includes(key)
}

/** Der Speicherschluessel EINER Seite — die Wahl gehoert der Seite, nicht der Sitzung. */
export function skinStorageKey(pageId) {
  return `obs-visu-editor-skin:${pageId}`
}

/**
 * Der gemerkte Skin dieser Seite, oder die Vorgabe.
 *
 * Jeder Zugriff ist gekapselt: ein privater Modus oder gesperrte Site-Daten
 * lassen `getItem` werfen, und daran darf der Editor nicht scheitern.
 */
export function readPageSkin(pageId, storage = globalThis.localStorage) {
  if (!pageId) return DEFAULT_VISU_SKIN
  try {
    const stored = storage?.getItem(skinStorageKey(pageId))
    return isKnownSkin(stored) ? stored : DEFAULT_VISU_SKIN
  } catch {
    return DEFAULT_VISU_SKIN
  }
}

/** Merkt sich den Skin dieser Seite. Ein unbekannter Schluessel wird nie abgelegt. */
export function writePageSkin(pageId, skin, storage = globalThis.localStorage) {
  if (!pageId || !isKnownSkin(skin)) return
  try {
    storage?.setItem(skinStorageKey(pageId), skin)
  } catch {
    // Der Ablage-Fehler darf den Editor nicht anhalten: die Wahl wirkt in dieser
    // Sitzung weiter, sie ueberlebt dann nur den Reload nicht.
  }
}
