import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  exportFileName,
  readExportDocument,
  triggerJsonDownload,
  uniqueImportName,
} from '@/utils/visuPageTransfer'

/**
 * Export und Import als Datei (M5 C6, Issue #173, Messlatte E18).
 *
 * Die Regel liegt hier, damit die Ansicht nur noch Knoepfe hat: wie eine
 * Ausfuhr heisst, wie sie den Browser erreicht, und was beim Einlesen
 * ABGELEHNT wird. Eine Datei, die kein Visu-Export ist, darf nicht in ein
 * `POST /visu/nodes/import` laufen und dort einen 400 provozieren, den niemand
 * mehr einem Bedienfehler zuordnen kann.
 */
describe('visuPageTransfer', () => {
  describe('exportFileName', () => {
    it('nennt die Datei nach der Seite', () => {
      expect(exportFileName('M5 Include Gamma')).toBe('M5_Include_Gamma_visu.json')
    })

    it('ersetzt alles, was kein Dateiname sein darf', () => {
      expect(exportFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j_visu.json')
    })

    it('faellt auf einen neutralen Namen zurueck, wenn die Seite keinen traegt', () => {
      expect(exportFileName('')).toBe('visu_export_visu.json')
      expect(exportFileName(null)).toBe('visu_export_visu.json')
    })

    it('kuerzt einen ausufernden Namen, statt einen unbrauchbaren Pfad zu bauen', () => {
      const name = exportFileName('x'.repeat(500))

      expect(name.length).toBeLessThanOrEqual(128)
      expect(name.endsWith('_visu.json')).toBe(true)
    })
  })

  /**
   * Der Import legt eine EIGENE Seite an. Landet sie neben ihrer Vorlage, sind
   * zwei gleichnamige Zeilen im Baum nicht auseinanderzuhalten - das Backend
   * verlangt beim Kopieren aus genau diesem Grund einen neuen Namen.
   */
  describe('uniqueImportName', () => {
    const format = (name, index) => `${name} (Kopie ${index})`

    it('laesst einen freien Namen in Ruhe', () => {
      expect(uniqueImportName('M5 Solo', ['M5 Home'], format)).toBe('M5 Solo')
    })

    it('weicht auf den ersten freien Vorschlag aus', () => {
      expect(uniqueImportName('M5 Solo', ['M5 Solo'], format)).toBe('M5 Solo (Kopie 1)')
    })

    it('zaehlt weiter, solange auch der Vorschlag vergeben ist', () => {
      const vergeben = ['M5 Solo', 'M5 Solo (Kopie 1)', 'M5 Solo (Kopie 2)']
      expect(uniqueImportName('M5 Solo', vergeben, format)).toBe('M5 Solo (Kopie 3)')
    })

    it('kommt ohne Liste aus', () => {
      expect(uniqueImportName('M5 Solo', null, format)).toBe('M5 Solo')
      expect(uniqueImportName('M5 Solo', undefined, format)).toBe('M5 Solo')
    })

    it('sucht nicht ewig: nach 500 Versuchen entscheidet die Uhr', () => {
      const vergeben = ['M5 Solo', ...Array.from({ length: 500 }, (_, i) => format('M5 Solo', i + 1))]
      const name = uniqueImportName('M5 Solo', vergeben, format)

      expect(vergeben).not.toContain(name)
      expect(name.startsWith('M5 Solo (Kopie ')).toBe(true)
    })
  })

  describe('readExportDocument', () => {
    const datei = (text) => ({ text: async () => text })

    it('nimmt einen Visu-Export an', async () => {
      const doc = { obs_export: 'visu_subtree', version: 1, nodes: [{ id: 'a', name: 'A', type: 'PAGE' }] }

      await expect(readExportDocument(datei(JSON.stringify(doc)))).resolves.toEqual({
        ok: true,
        document: doc,
      })
    })

    it('lehnt eine Datei ab, die kein JSON ist', async () => {
      await expect(readExportDocument(datei('nicht json'))).resolves.toMatchObject({
        ok: false,
        reason: 'syntax',
      })
    })

    it('lehnt ein JSON ab, das kein Visu-Export ist', async () => {
      await expect(readExportDocument(datei('{"foo": 1}'))).resolves.toMatchObject({
        ok: false,
        reason: 'shape',
      })
    })

    it('lehnt einen Export mit falscher Kennung ab', async () => {
      const doc = JSON.stringify({ obs_export: 'logic_graph', version: 1, nodes: [] })

      await expect(readExportDocument(datei(doc))).resolves.toMatchObject({ ok: false, reason: 'shape' })
    })

    it('lehnt einen Export ohne Knoten ab', async () => {
      const doc = JSON.stringify({ obs_export: 'visu_subtree', version: 1, nodes: [] })

      await expect(readExportDocument(datei(doc))).resolves.toMatchObject({ ok: false, reason: 'shape' })
    })

    it('lehnt einen Export ab, dessen `nodes` keine Liste ist', async () => {
      const doc = JSON.stringify({ obs_export: 'visu_subtree', version: 1, nodes: { a: 1 } })

      await expect(readExportDocument(datei(doc))).resolves.toMatchObject({ ok: false, reason: 'shape' })
    })

    it('lehnt „keine Datei" ab, statt daran zu zerbrechen', async () => {
      await expect(readExportDocument(null)).resolves.toMatchObject({ ok: false, reason: 'missing' })
    })

    it('lehnt eine unlesbare Datei ab', async () => {
      const kaputt = {
        text: async () => {
          throw new Error('nicht lesbar')
        },
      }

      await expect(readExportDocument(kaputt)).resolves.toMatchObject({ ok: false, reason: 'unreadable' })
    })
  })

  describe('triggerJsonDownload', () => {
    let created
    let revoked
    let geklickt

    beforeEach(() => {
      created = []
      revoked = []
      geklickt = []
      globalThis.URL.createObjectURL = vi.fn(() => {
        const url = `blob:test/${created.length}`
        created.push(url)
        return url
      })
      globalThis.URL.revokeObjectURL = vi.fn((url) => revoked.push(url))
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
      delete globalThis.URL.createObjectURL
      delete globalThis.URL.revokeObjectURL
    })

    /**
     * Der Anker mit `download` ist die einzige Affordanz, die im Browser eine
     * ECHTE Ausfuhr ausloest (und die einzige, die Playwright als `download`
     * sieht). Deshalb wird sie hier gepinnt und nicht nur „irgendwie" ein Blob
     * gebaut.
     */
    it('haengt einen Anker mit `download` an, klickt ihn und raeumt ihn wieder ab', () => {
      const anker = []
      const echtesCreate = document.createElement.bind(document)
      vi.spyOn(document, 'createElement').mockImplementation((tag) => {
        const el = echtesCreate(tag)
        if (tag === 'a') {
          anker.push(el)
          el.click = () => geklickt.push(el)
        }
        return el
      })

      triggerJsonDownload({ obs_export: 'visu_subtree' }, 'Seite_visu.json')

      expect(anker).toHaveLength(1)
      expect(anker[0].getAttribute('download')).toBe('Seite_visu.json')
      expect(anker[0].getAttribute('href')).toBe(created[0])
      expect(geklickt).toEqual(anker)
      expect(anker[0].isConnected).toBe(false)
      document.createElement.mockRestore()
    })

    it('gibt die Blob-Adresse erst spaeter frei - ein Ladevorgang laeuft noch', () => {
      triggerJsonDownload({ a: 1 }, 'x.json')

      expect(revoked).toEqual([])
      vi.runAllTimers()
      expect(revoked).toEqual(created)
    })

    it('schreibt das Dokument als eingerueckten JSON-Text in den Blob', () => {
      let inhalt = null
      const echterBlob = globalThis.Blob
      globalThis.Blob = class extends echterBlob {
        constructor(teile, options) {
          super(teile, options)
          inhalt = teile[0]
        }
      }
      try {
        triggerJsonDownload({ obs_export: 'visu_subtree', nodes: [] }, 'x.json')
      } finally {
        globalThis.Blob = echterBlob
      }

      expect(JSON.parse(inhalt)).toEqual({ obs_export: 'visu_subtree', nodes: [] })
      expect(inhalt).toContain('\n  ')
    })
  })
})
