import { describe, it, expect } from 'vitest';
import * as contract from '../src/index.js';

describe('@obs/visu-contract index exports', () => {
  it('exports version matching package.json (1.3.0 ⇒ contract "1.3")', () => {
    expect(contract.version).toBe('1.3');
  });

  it('exports the schema with declared version', () => {
    expect(contract.schema).toBeTypeOf('object');
    expect((contract.schema as Record<string, unknown>).version).toBe('1.3');
  });

  it('exports the fixtures with contractVersion', () => {
    // v1.3 ändert keine Datenform (nur Host-Aktionen) → Fixtures bleiben auf 1.2.
    expect(contract.fixtures).toBeTypeOf('object');
    expect((contract.fixtures as Record<string, unknown>).contractVersion).toBe('1.2');
  });
});
