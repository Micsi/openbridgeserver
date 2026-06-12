// @obs/visu-contract — versioned data/type contract between the obs Visu app and skins.
// Golden rule (7): the contract is data and types only — it executes nothing.
import schemaJson from '../contract.schema.json' with { type: 'json' };
import fixturesJson from '../fixtures.json' with { type: 'json' };

/**
 * The maschinenlesbare contract spec (roles · iconSlots · widgets).
 *
 * Typed as a broad record on purpose: re-exporting the raw JSON import would emit
 * a bare `import … from '../*.json'` into the public `.d.ts`, which a consumer on
 * `moduleResolution: NodeNext` rejects with TS1543 (import attributes required).
 * Annotating the export keeps the value but emits a `declare const`, so the entry
 * declaration stays valid under NodeNext.
 */
export const schema: Readonly<Record<string, unknown>> = schemaJson;
/** Sample states per type — the Prüfgrundlage for generator + Fixture-Wand. */
export const fixtures: Readonly<Record<string, unknown>> = fixturesJson;

/** The contract version (matches package.json major.minor; §2 declares "1.0"). */
export const version: string = schemaJson.version;

// Type surface — Device unions, Tokens, Ctx, Renderer, SkinManifest, SupportReport.
export type * from './types.js';
