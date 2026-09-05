/**
 * Die Widget-Palette des V2-Editors und ihre Formulare (M5 C3, Issue #170).
 *
 * DATEN, kein Verhalten: die Tabelle unten beschreibt je Kern-Typ, welche Felder
 * sein Bindungsformular hat und an welchen Pfad der Backend-Form sie schreiben.
 * Der Code darunter ist nur die Ableitung daraus (Goldene Regel: Daten = JSON,
 * Verhalten = Code) - kein `if (type === 'light')` im Formular, kein Datenfork.
 *
 * WOHER DIE TABELLE KOMMT (sie ist abgeleitet, nicht ausgedacht):
 *
 *  - **Welche neun Typen?** Die nicht-reservierten Widget-Schluessel des
 *    Vertrags (`packages/contract/contract.schema.json` -> `widgets`), also
 *    `CoreWidgetType` aus `packages/contract/src/types.ts`.
 *  - **Welches Ziel hat ein Feld?** Ein `data`-Feld oder eine `actions`-Aktion
 *    GENAU DIESES Typs im selben Vertrag.
 *  - **Welche Konfig-Schluessel?** Genau die, die die Abbildung der Visu
 *    (`apps/visu/src/core/obs/mapping.ts`) fuer diesen Typ liest - fuer die vier
 *    heute abgebildeten Typen maschinell nachgeprueft, indem die Probe die
 *    Abbildung mit einer mitschreibenden `config` befragt.
 *  - **Welcher Servertyp?** Die V1-Taxonomie (`frontend/src/widgets/<Typ>`),
 *    die dieselbe Abbildung spiegelt. Zwei Typen kennt V1 nicht; sie stehen
 *    deshalb in {@link NEUE_SERVERTYPEN} und sind damit als NEU deklariert.
 *
 * Der Zaun dazu: `gui/tests/utils/visuWidgetTypesDerivation.spec.js`. Er laedt
 * Vertrag, Abbildung und V1-Palette wirklich und faellt, sobald diese Kopie von
 * ihrer Quelle abweicht.
 *
 * GRENZE, die hier nicht weggeschrieben wird: die Abbildung der Visu kennt heute
 * nur `light`/`switch`/`blind`/`jalousie` (Issue #124). Ein Element der anderen
 * fuenf Typen wird gespeichert, erscheint aber noch in keiner Vorschau und in
 * keiner Visu. Das steht als `previewMapped: false` in den Daten, die Palette
 * sagt es dem Autor, und der Zaun haelt die Aussage an der echten Abbildung.
 */

/** Die neun Kern-Typen des Vertrags, in seiner Reihenfolge. */
export const CORE_WIDGET_TYPES = [
  'light',
  'switch',
  'blind',
  'jalousie',
  'sensor',
  'scene',
  'media',
  'camera',
  'climate',
]

/**
 * Servertypen, die die V1-Palette (`frontend/src/widgets/`) NICHT kennt.
 *
 * Fuer `scene` und `media` gibt es kein V1-Widget, aus dem sich ein Typname
 * ableiten liesse. Sie stehen deshalb hier: ein neuer Name, einmal und sichtbar
 * erklaert, statt eines still erfundenen zweiten Namens fuer etwas Bestehendes.
 */
export const NEUE_SERVERTYPEN = ['Szene', 'Medien']

/** Ein Datenpunkt-Feld: der Autor waehlt einen Datenpunkt. */
const dp = (key, path, target, labelKey, role) => ({
  key,
  path,
  target,
  labelKey,
  role,
  kind: 'datapoint',
  default: '',
})

/** Ein Textfeld (Einheit, Icon, Kamera-URL, Status-Beschriftung). */
const text = (key, path, target, labelKey) => ({
  key,
  path,
  target,
  labelKey,
  kind: 'text',
  default: '',
})

/** Ein Schalter (Umkehrung der Fahrtrichtung). */
const flag = (key, path, target, labelKey) => ({
  key,
  path,
  target,
  labelKey,
  kind: 'flag',
  default: false,
})

/** Eine Auswahl (Bauart/Leuchtmittel) - die Werte sind die der V1-Konfiguration. */
const choice = (key, path, target, labelKey, choices, dflt) => ({
  key,
  path,
  target,
  labelKey,
  choices,
  kind: 'choice',
  default: dflt,
})

/** Die vier Ampel-Status der Jalousie (`dp_status_i` + `label_status_i`). */
const jalousieStatusFelder = () => {
  const felder = []
  for (let i = 1; i <= 4; i += 1) {
    felder.push(
      dp(`dp_status_${i}`, `config.dp_status_${i}`, 'statuses', `visuEditor.fields.dpStatus${i}`, 'read'),
    )
    felder.push(
      text(
        `label_status_${i}`,
        `config.label_status_${i}`,
        'statuses',
        `visuEditor.fields.labelStatus${i}`,
      ),
    )
  }
  return felder
}

/**
 * Die Formulare. `previewMapped` sagt, ob die Abbildung der Visu diesen Typ
 * heute uebersetzt; `w`/`h` sind die Einfuegemasse der V1-Palette.
 */
export const WIDGET_FORMS = {
  light: {
    serverType: 'Licht', // frontend/src/widgets/Licht
    previewMapped: true,
    size: { w: 3, h: 4 },
    fields: [
      // V1 kennt zusaetzlich `tw`/`rgb`/`rgbw`; der Vertrag kennt an einem Licht
      // nur `on` und `dim`, deshalb stehen hier genau die zwei Modi, die er
      // ausdruecken kann.
      choice('mode', 'config.mode', 'dim', 'visuEditor.fields.lightMode', ['on_off', 'dimm'], 'dimm'),
      dp('dp_switch', 'config.dp_switch', 'on', 'visuEditor.fields.dpSwitch', 'write'),
      dp('dp_switch_status', 'config.dp_switch_status', 'on', 'visuEditor.fields.dpSwitchStatus', 'read'),
      dp('dp_dim', 'config.dp_dim', 'dim', 'visuEditor.fields.dpDim', 'write'),
      dp('dp_dim_status', 'config.dp_dim_status', 'dim', 'visuEditor.fields.dpDimStatus', 'read'),
    ],
  },
  switch: {
    serverType: 'Toggle', // frontend/src/widgets/Toggle
    previewMapped: true,
    size: { w: 2, h: 3 },
    fields: [
      dp('datapoint_id', 'datapoint_id', 'on', 'visuEditor.fields.datapoint', 'write'),
      dp('status_datapoint_id', 'status_datapoint_id', 'on', 'visuEditor.fields.statusDatapoint', 'read'),
    ],
  },
  blind: {
    serverType: 'Rolladen', // frontend/src/widgets/Rolladen (mode: 'rolladen')
    previewMapped: true,
    size: { w: 4, h: 4 },
    fields: [
      choice('mode', 'config.mode', 'type', 'visuEditor.fields.blindMode', ['rolladen', 'jalousie'], 'rolladen'),
      flag('invert', 'config.invert', 'position', 'visuEditor.fields.invert'),
      dp('dp_position', 'config.dp_position', 'position', 'visuEditor.fields.dpPosition', 'write'),
      dp('dp_position_status', 'config.dp_position_status', 'position', 'visuEditor.fields.dpPositionStatus', 'read'),
      dp('dp_lock', 'config.dp_lock', 'locked', 'visuEditor.fields.dpLock', 'read'),
    ],
  },
  jalousie: {
    serverType: 'Rolladen', // frontend/src/widgets/Rolladen (mode: 'jalousie')
    previewMapped: true,
    size: { w: 4, h: 4 },
    fields: [
      choice('mode', 'config.mode', 'type', 'visuEditor.fields.blindMode', ['rolladen', 'jalousie'], 'jalousie'),
      flag('invert', 'config.invert', 'invert', 'visuEditor.fields.invert'),
      dp('dp_position', 'config.dp_position', 'position', 'visuEditor.fields.dpPosition', 'write'),
      dp('dp_position_status', 'config.dp_position_status', 'position', 'visuEditor.fields.dpPositionStatus', 'read'),
      dp('dp_slat', 'config.dp_slat', 'slat', 'visuEditor.fields.dpSlat', 'write'),
      dp('dp_slat_status', 'config.dp_slat_status', 'slat', 'visuEditor.fields.dpSlatStatus', 'read'),
      dp('dp_lock', 'config.dp_lock', 'locked', 'visuEditor.fields.dpLock', 'read'),
      ...jalousieStatusFelder(),
    ],
  },
  sensor: {
    serverType: 'ValueDisplay', // frontend/src/widgets/ValueDisplay
    previewMapped: false,
    size: { w: 3, h: 2 },
    fields: [
      dp('datapoint_id', 'datapoint_id', 'value', 'visuEditor.fields.datapoint', 'read'),
      text('unit', 'config.unit', 'unit', 'visuEditor.fields.unit'),
    ],
  },
  scene: {
    serverType: 'Szene', // NEU (V1 kennt keine Szene) - s. NEUE_SERVERTYPEN
    previewMapped: false,
    size: { w: 2, h: 2 },
    fields: [
      dp('datapoint_id', 'datapoint_id', 'activateScene', 'visuEditor.fields.sceneTrigger', 'write'),
      text('icon', 'config.icon', 'icon', 'visuEditor.fields.icon'),
      text('sub', 'config.sub', 'sub', 'visuEditor.fields.sub'),
    ],
  },
  media: {
    serverType: 'Medien', // NEU (V1 kennt kein Medien-Widget) - s. NEUE_SERVERTYPEN
    previewMapped: false,
    size: { w: 4, h: 2 },
    fields: [
      dp('dp_play_state', 'config.dp_play_state', 'playState', 'visuEditor.fields.dpPlayState', 'read'),
      dp('dp_title', 'config.dp_title', 'title', 'visuEditor.fields.dpTitle', 'read'),
      dp('dp_volume', 'config.dp_volume', 'volume', 'visuEditor.fields.dpVolume', 'write'),
    ],
  },
  camera: {
    serverType: 'Kamera', // frontend/src/widgets/Kamera
    previewMapped: false,
    size: { w: 6, h: 4 },
    fields: [
      text('url', 'config.url', 'snapshotUrl', 'visuEditor.fields.cameraUrl'),
      dp('dp_online', 'config.dp_online', 'online', 'visuEditor.fields.dpOnline', 'read'),
    ],
  },
  climate: {
    serverType: 'RTR', // frontend/src/widgets/RTR
    previewMapped: false,
    size: { w: 3, h: 5 },
    fields: [
      dp('datapoint_id', 'datapoint_id', 'setpoint', 'visuEditor.fields.dpSetpoint', 'write'),
      dp('status_datapoint_id', 'status_datapoint_id', 'setpoint', 'visuEditor.fields.dpSetpointStatus', 'read'),
      dp('actual_temp_dp_id', 'config.actual_temp_dp_id', 'current', 'visuEditor.fields.dpCurrent', 'read'),
      dp('mode_dp_id', 'config.mode_dp_id', 'mode', 'visuEditor.fields.dpMode', 'read'),
    ],
  },
}

/** Das Formular eines Kern-Typs. Ein fremder Typ ist ein Fehler, keine Notform. */
export function widgetFormFields(type) {
  const form = WIDGET_FORMS[type]
  if (!form) throw new Error(`unknown_core_widget_type:${type}`)
  return form.fields
}

/** Die Konfig-Schluessel, die das Formular dieses Typs schreibt. */
export function widgetConfigKeys(type) {
  return widgetFormFields(type)
    .filter((field) => field.path.startsWith('config.'))
    .map((field) => field.path.slice('config.'.length))
}

/**
 * Ein neu platziertes Widget in Backend-Form (`obs/models/visu.py`
 * -> `WidgetInstance`). Die Konfig traegt jeden Schluessel des Formulars mit
 * seinem Vorgabewert - ein Schluessel, den es erst beim ersten Tippen gibt,
 * waere fuer die Abbildung dasselbe wie „nicht vorhanden".
 */
export function createWidget(type, { id, name = '', x = 0, y = 0 } = {}) {
  const form = WIDGET_FORMS[type]
  if (!form) throw new Error(`unknown_core_widget_type:${type}`)
  const config = {}
  for (const field of form.fields) {
    if (field.path.startsWith('config.')) config[field.path.slice('config.'.length)] = field.default
  }
  return {
    id,
    name,
    type: form.serverType,
    datapoint_id: null,
    status_datapoint_id: null,
    x,
    y,
    w: form.size.w,
    h: form.size.h,
    config,
  }
}

/**
 * Der Kern-Typ eines Server-Widgets - die Rueckrichtung von {@link createWidget}
 * und dieselbe Fallunterscheidung wie `obsKind` in der Abbildung der Visu
 * (`Rolladen` traegt beide Behaenge, unterschieden an `config.mode`).
 */
export function coreTypeOf(widget) {
  if (!widget || typeof widget.type !== 'string') return null
  if (widget.type === 'Rolladen') {
    return widget.config && widget.config.mode === 'jalousie' ? 'jalousie' : 'blind'
  }
  for (const type of CORE_WIDGET_TYPES) {
    if (type === 'blind' || type === 'jalousie') continue
    if (WIDGET_FORMS[type].serverType === widget.type) return type
  }
  return null
}

/** Der Wert eines Formularfeldes am Widget. */
export function readField(widget, field) {
  if (!widget || !field) return undefined
  if (field.path.startsWith('config.')) {
    return (widget.config || {})[field.path.slice('config.'.length)]
  }
  return widget[field.path]
}

/**
 * Das Widget mit neuem Feldwert - als NEUES Objekt. Der Entwurf wird ersetzt,
 * nie mutiert: sonst saehe die Vorschau eine Aenderung, die noch niemand
 * beschlossen hat, und `watch(..., { deep: true })` der Bruecke haette nichts
 * zu vergleichen.
 */
export function writeField(widget, field, value) {
  if (!field) return widget
  const leer = field.kind === 'flag' ? false : ''
  const wert = value === null || value === undefined ? leer : value
  if (field.path.startsWith('config.')) {
    return {
      ...widget,
      config: { ...(widget.config || {}), [field.path.slice('config.'.length)]: wert },
    }
  }
  // An der Wurzel steht `null` fuer „nicht gebunden" (so liest es das Backend).
  return { ...widget, [field.path]: wert === '' ? null : wert }
}
