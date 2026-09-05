import { describe, it, expect, beforeEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import {
  DEFAULT_VISU_SKIN,
  VISU_SKIN_KEYS,
  isKnownSkin,
  readPageSkin,
  skinStorageKey,
  writePageSkin,
} from '@/utils/visuSkins'

/**
 * Skin bzw. Theme pro Seite (M5 C1, Issue #168, Messlatte E19).
 *
 * Zwei Dinge stehen hier, und beide brauchen eine ehrliche Begruendung:
 *
 * 1. DIE SCHLUESSEL SIND EINE KOPIE. Die GUI liegt nicht im pnpm-Workspace der
 *    Visu (siehe `useVisuPreviewBridge.js`) und kann die Skin-Registry nicht
 *    importieren. Wie beim Vorschau-Protokoll wird die Kopie deshalb GEBUNDEN:
 *    die Spec unten liest `apps/visu/src/skin-host/skins.ts` und vergleicht die
 *    Schluessel. Ein Import ginge hier nicht - die Registry zieht die
 *    Skin-Pakete selbst herein.
 *
 * 2. DIE WAHL LIEGT HEUTE IM BROWSER. `PageConfig` (obs/models/visu.py) hat kein
 *    Feld fuer den Skin, und `save_page` schreibt `config.model_dump_json()` -
 *    ein zusaetzliches Feld faellt still weg. Der Editor darf `obs/` nicht
 *    anfassen (Teil A ist durch), also merkt er sich die Wahl je SEITE lokal.
 *    Das erfuellt E19 („die Wahl ueberlebt den Reload"), ist aber nicht dasselbe
 *    wie „steht im GET": der dauerhafte Platz waere `PageConfig.skin` und
 *    gehoert Teil A. Genau so steht es im Bericht.
 */

/** Ein Speicher, der sich wie `localStorage` verhaelt - ohne globalen Zustand. */
function memoryStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  }
}

/** Ein Speicher, der bei jedem Zugriff wirft (privater Modus, gesperrte Site-Daten). */
const brokenStorage = {
  getItem() {
    throw new Error('Speicher gesperrt')
  },
  setItem() {
    throw new Error('Speicher gesperrt')
  },
  removeItem() {
    throw new Error('Speicher gesperrt')
  },
}

describe('visuSkins - die Schluessel', () => {
  it('kennt genau die Skins der Registry', () => {
    expect(VISU_SKIN_KEYS).toEqual(['ionic', 'terminal', 'edomi'])
  })

  it('waehlt als Vorgabe einen Skin aus der eigenen Liste', () => {
    expect(VISU_SKIN_KEYS).toContain(DEFAULT_VISU_SKIN)
  })

  it('erkennt bekannte und unbekannte Schluessel', () => {
    expect(isKnownSkin('edomi')).toBe(true)
    expect(isKnownSkin('terminal')).toBe(true)
    expect(isKnownSkin('gibt-es-nicht')).toBe(false)
    expect(isKnownSkin(null)).toBe(false)
    expect(isKnownSkin(42)).toBe(false)
  })
})

describe('visuSkins - die Wahl je Seite', () => {
  let storage

  beforeEach(() => {
    storage = memoryStorage()
  })

  it('haengt die Seiten-ID in den Speicherschluessel', () => {
    expect(skinStorageKey('seite-1')).not.toBe(skinStorageKey('seite-2'))
    expect(skinStorageKey('seite-1')).toContain('seite-1')
  })

  it('liefert ohne Eintrag die Vorgabe', () => {
    expect(readPageSkin('seite-1', storage)).toBe(DEFAULT_VISU_SKIN)
  })

  it('gibt zurueck, was fuer DIESE Seite geschrieben wurde', () => {
    writePageSkin('seite-1', 'terminal', storage)
    writePageSkin('seite-2', 'ionic', storage)
    expect(readPageSkin('seite-1', storage)).toBe('terminal')
    expect(readPageSkin('seite-2', storage)).toBe('ionic')
  })

  it('schreibt keinen unbekannten Skin - sonst faellt die Vorschau spaeter hart', () => {
    writePageSkin('seite-1', 'gibt-es-nicht', storage)
    expect(readPageSkin('seite-1', storage)).toBe(DEFAULT_VISU_SKIN)
  })

  it('verwirft einen unbrauchbaren Eintrag beim Lesen', () => {
    storage.setItem(skinStorageKey('seite-1'), 'gibt-es-nicht')
    expect(readPageSkin('seite-1', storage)).toBe(DEFAULT_VISU_SKIN)
  })

  it('braucht ohne Seiten-ID gar nicht erst in den Speicher zu greifen', () => {
    expect(readPageSkin(null, brokenStorage)).toBe(DEFAULT_VISU_SKIN)
    expect(() => writePageSkin(null, 'terminal', brokenStorage)).not.toThrow()
  })

  it('bleibt bedienbar, wenn der Speicher wirft', () => {
    expect(readPageSkin('seite-1', brokenStorage)).toBe(DEFAULT_VISU_SKIN)
    expect(() => writePageSkin('seite-1', 'terminal', brokenStorage)).not.toThrow()
  })
})

/* ------------------------------------------------------- die gebundene Kopie */

const VISU_REL = join('apps', 'visu', 'src', 'skin-host', 'skins.ts')
const GUI_REL = join('gui', 'src', 'utils', 'visuSkins.js')

function repoRoot() {
  let dir = resolve(process.cwd())
  for (;;) {
    if (existsSync(join(dir, VISU_REL)) && existsSync(join(dir, GUI_REL))) return dir
    const up = dirname(dir)
    if (up === dir) throw new Error('Skin-Registry der Visu nicht gefunden - Repo umgebaut?')
    dir = up
  }
}

/**
 * Die Schluessel der Registry aus dem Quelltext - ueber Klammerzaehlung, nicht
 * ueber eine Regex quer durch die Datei.
 *
 * GRENZE, ausdruecklich: die Registry importiert die Skin-Pakete, laesst sich
 * also nicht wie das Vorschau-Protokoll als Modul laden. Gelesen wird deshalb
 * der Block `export const skins = { ... }` und daraus jeder Schluessel auf
 * Tiefe 1. Wird der Block umbenannt, faellt die Suche mit Klartext; wird er
 * anders geschrieben (berechnete Schluessel), faellt der Vergleich.
 */
function registryKeys(source) {
  const anchor = 'export const skins = {'
  const start = source.indexOf(anchor)
  if (start < 0) throw new Error(`Anker "${anchor}" fehlt - Registry umbenannt oder umgebaut?`)
  let depth = 0
  let end = -1
  for (let i = start + anchor.length - 1; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end < 0) throw new Error('Registry-Block nicht geschlossen - Quelle unbrauchbar?')

  const body = source.slice(start + anchor.length, end)
  const keys = []
  let level = 0
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    const match = level === 0 ? /^([A-Za-z_$][\w$]*)\s*:\s*\{/.exec(line) : null
    if (match) keys.push(match[1])
    for (const ch of line) {
      if (ch === '{') level += 1
      else if (ch === '}') level -= 1
    }
  }
  return keys
}

describe('visuSkins - die Kopie folgt der Registry der Visu', () => {
  it('nennt genau die Schluessel, die `skin-host/skins.ts` registriert', () => {
    const source = readFileSync(join(repoRoot(), VISU_REL), 'utf8')
    expect(registryKeys(source)).toEqual(VISU_SKIN_KEYS)
  })

  it('faellt, wenn der Anker in der Registry verschwindet - mit Klartext', () => {
    expect(() => registryKeys('const irgendwas = {}')).toThrow(/Anker/)
  })

  it('faellt, wenn der Block nicht geschlossen ist', () => {
    expect(() => registryKeys('export const skins = { ionic: {')).toThrow(/nicht geschlossen/)
  })

  it('liest verschachtelte Eintraege nicht als eigene Skins', () => {
    const probe = 'export const skins = {\n  ionic: {\n    manifest: {\n      tweaks: {},\n    },\n  },\n  terminal: {\n  },\n}'
    expect(registryKeys(probe)).toEqual(['ionic', 'terminal'])
  })
})
