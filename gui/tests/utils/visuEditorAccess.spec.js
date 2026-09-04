import { describe, it, expect } from 'vitest'
import {
  canUseVisuEditor,
  visuEditorGuard,
  previewOriginOf,
  VISU_EDITOR_ROUTE,
} from '@/utils/visuEditorAccess'

/**
 * Der Admin-Gate der Vorschau-Bruecke (C4, Issue #171).
 *
 * Der V2-Editor lebt in der Admin-GUI, weil hier die Berechtigungen ausgewertet
 * werden (CONTRIBUTING-visu-m5.md §2.4). Ein Nicht-Admin sieht den Bereich
 * nicht: weder im Menue noch ueber die Route.
 */
describe('visuEditorAccess — canUseVisuEditor', () => {
  it('sperrt einen Gast aus', () => {
    expect(canUseVisuEditor({ isLoggedIn: false, isAdmin: false })).toBe(false)
  })

  it('sperrt einen angemeldeten Nicht-Admin aus', () => {
    expect(canUseVisuEditor({ isLoggedIn: true, isAdmin: false })).toBe(false)
  })

  it('sperrt aus, wenn ein Admin-Flag ohne Anmeldung behauptet wird', () => {
    expect(canUseVisuEditor({ isLoggedIn: false, isAdmin: true })).toBe(false)
  })

  it('laesst einen angemeldeten Admin durch', () => {
    expect(canUseVisuEditor({ isLoggedIn: true, isAdmin: true })).toBe(true)
  })

  it('vertraut nichts, wenn gar kein Auth-Zustand da ist', () => {
    expect(canUseVisuEditor(null)).toBe(false)
    expect(canUseVisuEditor(undefined)).toBe(false)
    expect(canUseVisuEditor({})).toBe(false)
  })
})

describe('visuEditorAccess — visuEditorGuard', () => {
  it('leitet einen Nicht-Admin vom Editor weg', () => {
    const to = { path: VISU_EDITOR_ROUTE, meta: { admin: true } }
    expect(visuEditorGuard(to, { isLoggedIn: true, isAdmin: false })).toEqual({ name: 'Dashboard' })
  })

  it('leitet einen Gast vom Editor weg', () => {
    const to = { path: VISU_EDITOR_ROUTE, meta: { admin: true } }
    expect(visuEditorGuard(to, { isLoggedIn: false, isAdmin: false })).toEqual({ name: 'Dashboard' })
  })

  it('laesst einen Admin auf den Editor', () => {
    const to = { path: VISU_EDITOR_ROUTE, meta: { admin: true } }
    expect(visuEditorGuard(to, { isLoggedIn: true, isAdmin: true })).toBeUndefined()
  })

  it('mischt sich in fremde Routen nicht ein', () => {
    const to = { path: '/datapoints', meta: {} }
    expect(visuEditorGuard(to, { isLoggedIn: true, isAdmin: false })).toBeUndefined()
    expect(visuEditorGuard({ path: '/logs' }, null)).toBeUndefined()
  })
})

describe('visuEditorAccess — previewOriginOf', () => {
  it('leitet den Origin einer relativen Vorschau-URL aus dem eigenen Fenster ab', () => {
    expect(previewOriginOf('/visu-v2/preview', 'https://obs.example/gui/')).toBe('https://obs.example')
  })

  it('nimmt den Origin einer absoluten Vorschau-URL', () => {
    expect(previewOriginOf('http://localhost:5175/preview', 'http://localhost:5173/')).toBe(
      'http://localhost:5175',
    )
  })

  it('gibt null zurueck, wenn die URL unbrauchbar ist — lieber keine Bruecke als eine offene', () => {
    expect(previewOriginOf('', 'https://obs.example/')).toBeNull()
    expect(previewOriginOf('http://', 'https://obs.example/')).toBeNull()
    expect(previewOriginOf(null, 'https://obs.example/')).toBeNull()
  })
})
