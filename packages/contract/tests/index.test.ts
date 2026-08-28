import { describe, it, expect } from 'vitest';
import * as contract from '../src/index.js';

describe('@obs/visu-contract index exports', () => {
  it('exports version matching package.json (1.8.0 ⇒ contract "1.8")', () => {
    expect(contract.version).toBe('1.8');
  });

  it('exports the schema with declared version', () => {
    expect(contract.schema).toBeTypeOf('object');
    expect((contract.schema as Record<string, unknown>).version).toBe('1.8');
  });

  it('exports the fixtures with contractVersion', () => {
    // v1.8 ergänzt den Ctx-Helfer floorShort (Etagenkürzel); keine Device-Datenform-
    // Änderung, aber die Typen-/Helfer-Oberfläche wächst, also zieht die Version global nach.
    expect(contract.fixtures).toBeTypeOf('object');
    expect((contract.fixtures as Record<string, unknown>).contractVersion).toBe('1.8');
  });
});
