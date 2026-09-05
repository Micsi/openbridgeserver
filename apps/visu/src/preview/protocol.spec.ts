import { describe, it, expect } from 'vitest';

/**
 * preview/protocol - die Pruefungen, die aus einer fremden Nutzlast einen
 * Entwurf machen (C4, Issue #171).
 *
 * Der Empfaenger prueft Herkunft, Quelle, Kanal und Version; ab hier ist die
 * Nutzlast trotzdem noch fremd. Diese Spec pinnt die Formpruefung selbst: was
 * durchkommt, was abgewiesen wird - und dass jede einzelne Bedingung wirklich
 * traegt (eine weggelassene Pruefung muss hier rot werden, nicht nur die
 * offensichtliche).
 */
import {
  readDraft,
  readEnvelope,
  readSession,
  themeOfTweaks,
  PREVIEW_CHANNEL,
  PREVIEW_MESSAGE,
  PREVIEW_PROTOCOL_VERSION,
} from './protocol';

const NODE = {
  id: 'p1',
  parent_id: null,
  name: 'Wohnen',
  type: 'PAGE',
  kind: 'normal',
  page_config: { widgets: [] },
};

const DRAFT = { skin: 'edomi', pageId: 'p1', nodes: [NODE] };

describe('preview/protocol - readDraft', () => {
  it('nimmt einen vollstaendigen Entwurf an', () => {
    expect(readDraft(DRAFT)).toEqual(DRAFT);
  });

  it('weist einen Entwurf ohne brauchbare Seiten-id ab', () => {
    // Ohne `pageId` weiss die Vorschau nicht, WELCHE Seite sie zeigen soll - sie
    // wuerde eine beliebige rendern und der Wert liefe als `X-Page-Id` mit.
    expect(readDraft({ ...DRAFT, pageId: undefined })).toBeNull();
    expect(readDraft({ ...DRAFT, pageId: '' })).toBeNull();
    expect(readDraft({ ...DRAFT, pageId: 42 })).toBeNull();
    expect(readDraft({ ...DRAFT, pageId: { id: 'p1' } })).toBeNull();
  });

  it('weist einen Entwurf ohne brauchbaren Skin-Schluessel ab', () => {
    expect(readDraft({ ...DRAFT, skin: undefined })).toBeNull();
    expect(readDraft({ ...DRAFT, skin: '' })).toBeNull();
    expect(readDraft({ ...DRAFT, skin: 7 })).toBeNull();
  });

  it('weist einen Entwurf ohne verwertbare Knoten ab', () => {
    expect(readDraft({ ...DRAFT, nodes: [] })).toBeNull();
    expect(readDraft({ ...DRAFT, nodes: 'p1' })).toBeNull();
    expect(readDraft({ ...DRAFT, nodes: [{ ...NODE, id: '' }] })).toBeNull();
    expect(readDraft({ ...DRAFT, nodes: [{ ...NODE, type: 'WIDGET' }] })).toBeNull();
    expect(readDraft({ ...DRAFT, nodes: [null] })).toBeNull();
  });

  it('weist alles ab, was gar kein Objekt ist', () => {
    for (const value of [null, undefined, 'hallo', 42, [], true]) {
      expect(readDraft(value)).toBeNull();
    }
  });
});

describe('preview/protocol - Theme und Tweaks (v1.1)', () => {
  it('reicht Theme und Tweaks durch - sie bestimmen die Wurzel der Seite', () => {
    const tweaks = { stil: 'ios', glassBlur: 8, showTitlebar: true };
    expect(readDraft({ ...DRAFT, theme: 'dark', tweaks })).toEqual({
      ...DRAFT,
      theme: 'dark',
      tweaks,
    });
  });

  it('laesst einen Entwurf ohne Theme und Tweaks zu (beide sind optional)', () => {
    const draft = readDraft(DRAFT);
    expect(draft).not.toBeNull();
    expect(draft!.theme).toBeUndefined();
    expect(draft!.tweaks).toBeUndefined();
  });

  it('weist ein unbekanntes Theme ab, statt es still zu verwerfen', () => {
    expect(readDraft({ ...DRAFT, theme: 'neon' })).toBeNull();
    expect(readDraft({ ...DRAFT, theme: 3 })).toBeNull();
  });

  it('weist Tweak-Werte ab, die kein Skin in ein Attribut schreiben koennte', () => {
    expect(readDraft({ ...DRAFT, tweaks: { stil: { a: 1 } } })).toBeNull();
    expect(readDraft({ ...DRAFT, tweaks: { stil: ['ios'] } })).toBeNull();
    expect(readDraft({ ...DRAFT, tweaks: 'ios' })).toBeNull();
  });

  it('leitet das Token-Theme genau wie die echte Seite aus den Tweaks ab', () => {
    expect(themeOfTweaks({ theme: 'dark' })).toBe('dark');
    expect(themeOfTweaks({ theme: 'image' })).toBe('image');
    // Alles andere ist `light` - die Regel aus SkinPage.vue, kein eigener Boden.
    expect(themeOfTweaks({ theme: 'neon' })).toBe('light');
    expect(themeOfTweaks({})).toBe('light');
    expect(themeOfTweaks(undefined)).toBe('light');
  });
});

describe('preview/protocol - readSession und readEnvelope', () => {
  it('nimmt nie ein leeres oder fremdgeformtes Token an', () => {
    expect(readSession({ accessToken: 'abc' })).toEqual({ accessToken: 'abc' });
    expect(readSession({ accessToken: '' })).toBeNull();
    expect(readSession({ accessToken: 42 })).toBeNull();
    expect(readSession({})).toBeNull();
    expect(readSession(null)).toBeNull();
  });

  it('liest nur Nachrichten mit dem Kanal-Marker und der Versionsangabe', () => {
    expect(
      readEnvelope({
        channel: PREVIEW_CHANNEL,
        type: PREVIEW_MESSAGE.init,
        protocol: PREVIEW_PROTOCOL_VERSION,
      }),
    ).toMatchObject({ type: PREVIEW_MESSAGE.init, protocol: PREVIEW_PROTOCOL_VERSION });
    expect(readEnvelope({ type: PREVIEW_MESSAGE.init })).toBeNull();
    expect(readEnvelope({ channel: 'anderer-kanal', type: PREVIEW_MESSAGE.init })).toBeNull();
    expect(readEnvelope({ channel: PREVIEW_CHANNEL, type: 7 })).toBeNull();
  });
});
