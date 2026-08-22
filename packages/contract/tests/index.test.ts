import { describe, it, expect } from 'vitest';
import * as contract from '../src/index.js';

describe('@obs/visu-contract index exports', () => {
  it('exports version matching package.json (1.4.0 ⇒ contract "1.4")', () => {
    expect(contract.version).toBe('1.4');
  });

  it('exports the schema with declared version', () => {
    expect(contract.schema).toBeTypeOf('object');
    expect((contract.schema as Record<string, unknown>).version).toBe('1.4');
  });

  it('exports the fixtures with contractVersion', () => {
    // v1.4 fügt den Kern-Typ climate + optionale Sensor-/Base-Felder hinzu (Datenform-Diff)
    // → Fixtures ziehen auf contractVersion 1.4 nach.
    expect(contract.fixtures).toBeTypeOf('object');
    expect((contract.fixtures as Record<string, unknown>).contractVersion).toBe('1.4');
  });
});
