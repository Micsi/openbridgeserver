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
 * 2. DIE WAHL LIEGT HEUTE IM BROWSER DES AUTORS — SIE GEHOERT DER SEITE NOCH
 *    NICHT. `PageConfig` (`obs/models/visu.py`) hat kein Feld fuer den Skin, und
 *    `save_page` schreibt `config.model_dump_json()`; ein zusaetzliches Feld
 *    faellt still weg. Gemessen heisst das: `GET /visu/pages/{id}` traegt keinen
 *    Skin, und ein ZWEITER Browser (oder ein anderer Autor) sieht die Vorgabe.
 *    Der Editor merkt sich die Wahl deshalb je SEITEN-ID im `localStorage` —
 *    getrennt je Seite, aber eben nur hier. Das ist NICHT das Kriterium aus §3
 *    („jede Eigenschaft setzen → `GET` zeigt sie"), und E19 steht solange auf
 *    `test.fixme` (`apps/visu/e2e/m5-editor-matrix.spec.ts`).
 *
 *    DIE NAHT STEHT SCHON: Teil C2 ergaenzt `PageConfig` additiv um ein Feld
 *    fuer den Skin je Seite (Issue #169). Sobald das im Baum ist, traegt jede
 *    geladene Konfiguration den Schluessel {@link PAGE_SKIN_FIELD} — und genau
 *    daran schalten sich {@link skinFromPageConfig} (Lesen) und
 *    {@link withPageSkin} (Schreiben) VON SELBST ein: der Editor schreibt das
 *    Feld erst, wenn das Backend es fuehrt, und liest es, sobald es da ist.
 *    Heisst das Feld am Ende anders, ist genau eine Konstante zu aendern.
 */

/** Die Schluessel der Skin-Registry der Visu, in ihrer Reihenfolge. */
export const VISU_SKIN_KEYS = Object.freeze(['ionic', 'terminal', 'edomi'])

/**
 * Die Vorgabe. `edomi` ist der einzige seitenbesitzende Skin (§2.5) und damit
 * der realistische Fall fuer Seitentypen, Layering und Popups.
 */
export const DEFAULT_VISU_SKIN = 'edomi'

/**
 * Der Feldname, unter dem eine `PageConfig` ihren Skin traegt, sobald Teil C2
 * ihn ergaenzt hat. EINE Stelle — Lesen, Schreiben und die Erkennung, ob das
 * Backend das Feld ueberhaupt fuehrt, haengen daran.
 */
export const PAGE_SKIN_FIELD = 'skin'

/** Kennt die Vorschau diesen Skin? */
export function isKnownSkin(key) {
  return typeof key === 'string' && VISU_SKIN_KEYS.includes(key)
}

/**
 * Fuehrt diese GESPEICHERTE Konfiguration das Skin-Feld?
 *
 * Gefragt ist die Anwesenheit des Schluessels, nicht sein Wert: eine Seite, die
 * heute `null` traegt, wird trotzdem geschrieben — eine Seite eines Backends
 * ohne das Feld nicht.
 */
export function pageConfigCarriesSkin(config) {
  return Boolean(config) && typeof config === 'object' && Object.hasOwn(config, PAGE_SKIN_FIELD)
}

/** Der Skin aus einer gespeicherten `page_config` — `null`, wenn es keinen gibt. */
export function skinFromPageConfig(config) {
  const value = config?.[PAGE_SKIN_FIELD]
  return isKnownSkin(value) ? value : null
}

/**
 * Legt den Skin in einen Seiten-Rumpf — aber nur, wenn das Backend das Feld
 * fuehrt (`supported`). Ohne diese Bedingung schickte der Editor ein Feld, das
 * `PageConfig` still verwirft: eine Zusage, die niemand einloest.
 */
export function withPageSkin(body, skin, supported) {
  if (supported !== true || !isKnownSkin(skin)) return body
  return { ...body, [PAGE_SKIN_FIELD]: skin }
}

/**
 * Der Speicherschluessel EINER Seite.
 *
 * Je Seite getrennt — aber im Browser des Autors, nicht in der Seite (siehe
 * Grenze 2 im Kopf). Ein zweiter Browser kennt diesen Schluessel nicht.
 */
export function skinStorageKey(pageId) {
  return `obs-visu-editor-skin:${pageId}`
}

/**
 * Der im Browser gemerkte Skin dieser Seite, oder die Vorgabe.
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

/** Merkt sich den Skin dieser Seite im Browser. Ein unbekannter Schluessel wird nie abgelegt. */
export function writePageSkin(pageId, skin, storage = globalThis.localStorage) {
  if (!pageId || !isKnownSkin(skin)) return
  try {
    storage?.setItem(skinStorageKey(pageId), skin)
  } catch {
    // Der Ablage-Fehler darf den Editor nicht anhalten: die Wahl wirkt in dieser
    // Sitzung weiter, sie ueberlebt dann nur den Reload nicht.
  }
}
