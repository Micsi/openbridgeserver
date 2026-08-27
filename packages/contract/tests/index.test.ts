import { describe, it, expect } from 'vitest';
import * as contract from '../src/index.js';

describe('@obs/visu-contract index exports', () => {
  it('exports version matching package.json (1.7.0 ⇒ contract "1.7")', () => {
    expect(contract.version).toBe('1.7');
  });

  it('exports the schema with declared version', () => {
    expect(contract.schema).toBeTypeOf('object');
    expect((contract.schema as Record<string, unknown>).version).toBe('1.7');
  });

  it('exports the fixtures with contractVersion', () => {
    // v1.7 fügt das optionale Manifest-Feld gestures (Skin-Interaktionsmodell) hinzu;
    // keine Device-Datenform-Änderung, aber die Version zieht global nach.
    expect(contract.fixtures).toBeTypeOf('object');
    expect((contract.fixtures as Record<string, unknown>).contractVersion).toBe('1.7');
  });
});
