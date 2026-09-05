/**
 * Ein Vorschau-Entwurf aus ZWEI Haenden (Integration M5 C1/C2/C3).
 *
 * Der Editor hat zwei Teile, die denselben Entwurf beschreiben, und beide sind
 * gewollt:
 *
 *  - der AUTORENTEIL (C1 Issue #168 + C3 Issue #170): Seiteneigenschaften
 *    (Skin, Includes, Popup, Zugriff) und die Elemente mit ihren Bindungen und
 *    ihrer Sichtbarkeitsregel - samt der Elemente, die gerade erst aus der
 *    Palette kamen und den Server noch nie gesehen haben.
 *  - der CANVAS (C2 Issue #169): die LAGE derselben Elemente, der Layout-Modus
 *    der Seite samt Rasterweite und Breakpoints, die Layer-Schalter und das
 *    Ausblenden einzelner Kacheln (E8).
 *
 * Beide erzeugen einen vollstaendigen Entwurf nach Protokoll 1.1. Wer einfach
 * einen von beiden nach vorne stellt, verliert die andere Haelfte: nimmt man den
 * Canvas, fehlen Bindung und Sichtbarkeitsregel; nimmt man den Autorenteil,
 * fehlen Lage und Modus, und E1/E2/E4/E8 haetten nichts zu messen.
 *
 * ZUSTAENDIGKEITEN, so aufgeteilt, wie die Bedienelemente stehen:
 *
 *  | Belang                              | Wer entscheidet |
 *  |-------------------------------------|-----------------|
 *  | Skin, Name, Typ, Zugriff, Popup     | Autorenteil     |
 *  | Elemente, Bindung, Sichtbarkeit     | Autorenteil     |
 *  | `layout_mode`, `grid`, `breakpoints`| Canvas          |
 *  | Autoren-Box (x/y/w/h) je Element    | Canvas          |
 *  | Ausgeblendete Kacheln (E8)          | Canvas          |
 *  | Layer aus dem Bild nehmen           | Canvas, ADDITIV |
 *
 * „Additiv" beim letzten Punkt heisst: der Canvas kann einen Layer nur
 * WEGNEHMEN, nie hinzufuegen. `ignore_global_includes` wird deshalb
 * oder-verknuepft, und eine leere `includes`-Liste des Canvas leert auch die
 * gemeinsame. Das ist keine Naeherung, sondern genau die Bedeutung der beiden
 * Schalter - und der Knotensatz stammt ohnehin vom Server (der Autorenteil
 * laedt die Include-Kette beim Oeffnen), sodass eine NOCH NICHT gespeicherte
 * Include-Beziehung in keinem der beiden Entwuerfe einen Knoten haette.
 *
 * Rein: gleiche Eingabe, gleiche Ausgabe, keine Seiteneffekte.
 */
import { BOX_KEYS } from '@/utils/visuEditorPage'

/** Die Felder der Seite, die am Canvas haengen (der Modus und sein Zubehoer). */
export const CANVAS_PAGE_KEYS = ['layout_mode', 'grid', 'breakpoints']

/**
 * Die Autoren-Box eines Elements aus dem Canvas uebernehmen.
 *
 * Kennt der Canvas das Element nicht (frisch aus der Palette, noch nie
 * gespeichert), bleibt es unangetastet - eine erfundene Lage waere schlimmer als
 * keine. Kennt er es OHNE Box, verliert es seine: „unvollstaendig ist keine
 * Box" gilt auch hier, und der Host laesst sie dann weg.
 */
function withCanvasBox(widget, canvasWidget) {
  if (!canvasWidget) return widget
  const out = { ...widget }
  for (const key of BOX_KEYS) {
    if (typeof canvasWidget[key] === 'number') out[key] = canvasWidget[key]
    else delete out[key]
  }
  return out
}

/**
 * Die beiden Entwuerfe zu EINEM zusammenlegen.
 *
 * `hiddenIds` sind die Kacheln, die der Canvas gerade ausblendet (E8) - sie
 * stehen NICHT in seinem Entwurf und muessen deshalb ausdruecklich mitkommen,
 * sonst brachte der Autorenteil sie wieder ins Bild.
 *
 * Fehlt eine Seite, gewinnt die andere unveraendert; zeigen beide auf
 * verschiedene Seiten (der Canvas laedt spaeter als die Adresse wechselt),
 * gewinnt der Canvas - er ist der, der die neue Seite schon hat.
 *
 * Am Ende ein Klon aus reinen Daten: ein Vue-Proxy scheitert im `postMessage`
 * der Bruecke mit „could not be cloned".
 */
export function mergePreviewDrafts(basis, canvas, optionen = {}) {
  const hidden = new Set(optionen.hiddenIds ?? [])
  if (!canvas) return basis
  if (!basis) return canvas
  if (basis.pageId !== canvas.pageId) return canvas
  const canvasPage = (canvas.nodes ?? []).find((node) => node.id === canvas.pageId) ?? null
  if (!canvasPage) return basis
  const canvasConfig = canvasPage.page_config ?? {}
  const canvasWidgets = new Map(
    (canvasConfig.widgets ?? []).filter((w) => w && w.id).map((w) => [w.id, w]),
  )

  const nodes = (basis.nodes ?? []).map((node) => {
    if (node.id !== basis.pageId) return node
    const config = node.page_config ?? {}
    const canvasIncludes = canvasConfig.includes ?? []
    const settings = {}
    for (const key of CANVAS_PAGE_KEYS) {
      if (key in canvasConfig) settings[key] = canvasConfig[key]
    }
    return {
      ...node,
      page_config: {
        ...config,
        ...settings,
        includes: canvasIncludes.length === 0 ? [] : (config.includes ?? []),
        ignore_global_includes:
          config.ignore_global_includes === true || canvasConfig.ignore_global_includes === true,
        widgets: (config.widgets ?? [])
          .filter((widget) => widget && !hidden.has(widget.id))
          .map((widget) => withCanvasBox(widget, canvasWidgets.get(widget.id))),
      },
    }
  })

  return JSON.parse(JSON.stringify({ ...basis, nodes }))
}

export default mergePreviewDrafts
