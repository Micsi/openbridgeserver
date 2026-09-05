import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import LoginView from '@/views/LoginView.vue'

/**
 * Die Beschriftungen der Anmeldemaske sind mit ihren Feldern VERBUNDEN
 * (M5 C2, Issue #169).
 *
 * Vorher standen `<label>` und `<input>` als Geschwister nebeneinander, ohne
 * `for`/`id`: der zugaengliche Name des Feldes kam dann aus dem Platzhalter
 * („admin", „••••••••"), nicht aus der Beschriftung. Fuer eine Bedienhilfe ist
 * das ein Feld ohne Namen; fuer den M5-Harness war es die Stelle, an der jedes
 * Editor-Szenario schon an der Anmeldung scheiterte
 * (`getByLabel('Benutzername')` fand nichts).
 *
 * Der Test prueft die VERBINDUNG, nicht den Text: er ist damit gegen eine
 * Uebersetzung unempfindlich und faellt genau dann, wenn `for`/`id` wieder
 * auseinanderlaufen.
 */

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

describe('LoginView - Beschriftung und Feld gehoeren zusammen', () => {
  it('verbindet jedes Label ueber for/id mit seinem Eingabefeld', () => {
    const w = mount(LoginView)
    const labels = w.findAll('label')
    expect(labels.length).toBeGreaterThanOrEqual(2)
    for (const label of labels) {
      const target = label.attributes('for')
      expect(target, `Label „${label.text()}" ohne for-Attribut`).toBeTruthy()
      expect(w.find(`#${target}`).exists()).toBe(true)
    }
  })

  it('bindet Benutzername und Passwort an die erwarteten Felder', () => {
    const w = mount(LoginView)
    expect(w.find('label[for="login-username"]').exists()).toBe(true)
    expect(w.find('input#login-username').attributes('data-testid')).toBe('input-username')
    expect(w.find('label[for="login-password"]').exists()).toBe(true)
    expect(w.find('input#login-password').attributes('type')).toBe('password')
  })
})
