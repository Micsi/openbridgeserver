import { describe, it, expect } from 'vitest';
import * as contract from '../src/index.js';

describe('@obs/visu-contract index exports', () => {
  it('exports version matching package.json (1.6.0 ⇒ contract "1.6")', () => {
    expect(contract.version).toBe('1.6');
  });

  it('exports the schema with declared version', () => {
    expect(contract.schema).toBeTypeOf('object');
    expect((contract.schema as Record<string, unknown>).version).toBe('1.6');
  });

  it('exports the fixtures with contractVersion', () => {
    // v1.6 fügt das optionale Feld presets (blind/jalousie) + Aktion applyPreset hinzu
    // (Datenform-/Aktions-Diff) → Fixtures ziehen auf contractVersion 1.6 nach.
    expect(contract.fixtures).toBeTypeOf('object');
    expect((contract.fixtures as Record<string, unknown>).contractVersion).toBe('1.6');
  });
});
