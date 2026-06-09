import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import schema from '../contract.schema.json' with { type: 'json' };
import fixtures from '../fixtures.json' with { type: 'json' };

describe('@obs/visu-contract smoke', () => {
  it('ships a placeholder contract schema', () => {
    expect(schema).toBeTypeOf('object');
  });

  it('ships a placeholder fixtures document', () => {
    expect(fixtures).toBeTypeOf('object');
  });

  it('can construct an ajv validator with formats (schema-validation harness ready)', () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema as object);
    // The empty placeholder schema accepts anything; this just proves the harness wires up.
    expect(validate({})).toBe(true);
  });
});
