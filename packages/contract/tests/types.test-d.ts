import { describe, it, expectTypeOf } from 'vitest';
import type {
  Device,
  LightDevice,
  SwitchDevice,
  BlindDevice,
  JalousieDevice,
  SensorDevice,
  SceneDevice,
  MediaDevice,
  CameraDevice,
  ClimateDevice,
  PositionPreset,
  Tokens,
  Ctx,
  Renderer,
  SkinManifest,
  SkinGestures,
  GestureTarget,
  SupportReport,
  WidgetAction,
  WidgetPosition,
  PageKind,
  LayerItem,
  PageLayer,
  PopupDescriptor,
  Role,
  NavNode,
  PageHost,
  PageRenderer,
  PageLink,
  LinkIndicator,
  LinkOutcome,
  LinkNavigate,
  LinkGate,
  LinkUnknown,
} from '../src/types.js';

describe('Device unions (§5) — readonly', () => {
  it('Device is the union of all core device shapes', () => {
    expectTypeOf<LightDevice>().toMatchTypeOf<Device>();
    expectTypeOf<SwitchDevice>().toMatchTypeOf<Device>();
    expectTypeOf<BlindDevice>().toMatchTypeOf<Device>();
    expectTypeOf<JalousieDevice>().toMatchTypeOf<Device>();
    expectTypeOf<SensorDevice>().toMatchTypeOf<Device>();
    expectTypeOf<SceneDevice>().toMatchTypeOf<Device>();
    expectTypeOf<MediaDevice>().toMatchTypeOf<Device>();
    expectTypeOf<CameraDevice>().toMatchTypeOf<Device>();
    expectTypeOf<ClimateDevice>().toMatchTypeOf<Device>();
  });

  it('climate (v1.4) carries its discriminant and fields', () => {
    expectTypeOf<ClimateDevice['type']>().toEqualTypeOf<'climate'>();
    expectTypeOf<ClimateDevice['setpoint']>().toEqualTypeOf<number>();
    expectTypeOf<ClimateDevice['current']>().toEqualTypeOf<number>();
    expectTypeOf<ClimateDevice['mode']>().toEqualTypeOf<'heat' | 'cool' | 'off' | 'auto'>();
    expectTypeOf<ClimateDevice['unit']>().toEqualTypeOf<string>();
  });

  it('sensor (v1.4) carries optional icon/series/min/max', () => {
    expectTypeOf<SensorDevice['icon']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<SensorDevice['series']>().toEqualTypeOf<readonly number[] | undefined>();
    expectTypeOf<SensorDevice['min']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<SensorDevice['max']>().toEqualTypeOf<number | undefined>();
  });

  it('every device carries the optional base field floor (v1.4)', () => {
    expectTypeOf<LightDevice['floor']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ClimateDevice['floor']>().toEqualTypeOf<string | undefined>();
  });

  it('every device carries the optional base field writable (v1.5)', () => {
    expectTypeOf<LightDevice['writable']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<SwitchDevice['writable']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<SensorDevice['writable']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<ClimateDevice['writable']>().toEqualTypeOf<boolean | undefined>();
  });

  it('positionsbasierte Geräte tragen das optionale Feld presets (v1.6)', () => {
    expectTypeOf<BlindDevice['presets']>().toEqualTypeOf<readonly PositionPreset[] | undefined>();
    expectTypeOf<JalousieDevice['presets']>().toEqualTypeOf<readonly PositionPreset[] | undefined>();
  });

  it('PositionPreset trägt label/position und optionales slat (v1.6)', () => {
    expectTypeOf<PositionPreset['label']>().toEqualTypeOf<string>();
    expectTypeOf<PositionPreset['position']>().toEqualTypeOf<number>();
    expectTypeOf<PositionPreset['slat']>().toEqualTypeOf<number | undefined>();
  });

  it('media/camera (v1.2) carry their discriminants and fields', () => {
    expectTypeOf<MediaDevice['type']>().toEqualTypeOf<'media'>();
    expectTypeOf<MediaDevice['playState']>().toEqualTypeOf<'playing' | 'paused' | 'stopped'>();
    expectTypeOf<MediaDevice['volume']>().toEqualTypeOf<number>();
    expectTypeOf<CameraDevice['type']>().toEqualTypeOf<'camera'>();
    expectTypeOf<CameraDevice['online']>().toEqualTypeOf<boolean>();
    expectTypeOf<CameraDevice['snapshotUrl']>().toEqualTypeOf<string | null>();
  });

  it('light device carries its discriminant and fields', () => {
    expectTypeOf<LightDevice['type']>().toEqualTypeOf<'light'>();
    expectTypeOf<LightDevice['on']>().toEqualTypeOf<boolean>();
    expectTypeOf<LightDevice['dim']>().toEqualTypeOf<number | null>();
  });

  it('blind/jalousie position is a number', () => {
    expectTypeOf<BlindDevice['position']>().toEqualTypeOf<number>();
    expectTypeOf<JalousieDevice['slat']>().toEqualTypeOf<number>();
    expectTypeOf<JalousieDevice['moving']>().toEqualTypeOf<'up' | 'down' | null>();
  });

  it('device fields are readonly (golden rule 1/4: skins read-only)', () => {
    // @ts-expect-error device fields are readonly
    const mutate = (d: LightDevice) => { d.on = true; };
    void mutate;
  });
});

describe('Tokens (§5)', () => {
  it('exposes accent/accentInk/font/space', () => {
    expectTypeOf<Tokens['accent']>().toEqualTypeOf<(token: string) => string>();
    expectTypeOf<Tokens['accentInk']>().toEqualTypeOf<(token: string) => string>();
    expectTypeOf<Tokens['font']>().toEqualTypeOf<string>();
    expectTypeOf<Tokens['space']>().toEqualTypeOf<(step: number) => string>();
  });
});

describe('Ctx (§5) — sandbox helpers', () => {
  it('exposes stateText/hyphenate/icon/nf/warn', () => {
    expectTypeOf<Ctx['stateText']>().toEqualTypeOf<(d: Device) => string>();
    expectTypeOf<Ctx['stateParts']>().toEqualTypeOf<
      (d: Device) => { readonly word: string; readonly rest: string }
    >();
    expectTypeOf<Ctx['hyphenate']>().toEqualTypeOf<(text: string) => string>();
    expectTypeOf<Ctx['floorShort']>().toEqualTypeOf<(d: Device) => string>();
    expectTypeOf<Ctx['icon']>().toEqualTypeOf<(d: Device, slot: string) => string>();
    expectTypeOf<Ctx['warn']>().toEqualTypeOf<(d: Device) => boolean>();
    expectTypeOf<Ctx['nf']>().parameter(0).toEqualTypeOf<number | string>();
    expectTypeOf<Ctx['nf']>().returns.toEqualTypeOf<string>();
  });

  it('exposes an optional host-injected translator t (v1.1)', () => {
    expectTypeOf<Ctx['t']>().toEqualTypeOf<
      ((key: string, params?: Record<string, unknown>) => string) | undefined
    >();
  });
});

describe('Renderer (§5)', () => {
  it('is a pure function (d,t,ctx) => string | VNode', () => {
    expectTypeOf<Renderer>().parameters.toEqualTypeOf<[Device, Tokens, Ctx]>();
    expectTypeOf<Renderer>().returns.toMatchTypeOf<string | unknown>();
  });
});

describe('WidgetAction (§6)', () => {
  it('includes the v1.4 climate action setSetpoint', () => {
    expectTypeOf<'setSetpoint'>().toMatchTypeOf<WidgetAction>();
  });

  it('includes the v1.6 preset action applyPreset', () => {
    expectTypeOf<'applyPreset'>().toMatchTypeOf<WidgetAction>();
  });
});

describe('SkinManifest (§7)', () => {
  it('carries name/targetsContract/renderers/unsupported/widgets/layout', () => {
    expectTypeOf<SkinManifest['name']>().toEqualTypeOf<string>();
    expectTypeOf<SkinManifest['targetsContract']>().toEqualTypeOf<string>();
    expectTypeOf<SkinManifest['unsupported']>().toEqualTypeOf<readonly string[]>();
    expectTypeOf<SkinManifest>().toHaveProperty('widgets');
    expectTypeOf<SkinManifest>().toHaveProperty('layout');
  });

  it('carries an optional skin gesture model (v1.7)', () => {
    expectTypeOf<SkinManifest['gestures']>().toEqualTypeOf<SkinGestures | undefined>();
    expectTypeOf<SkinGestures['tap']>().toEqualTypeOf<GestureTarget | undefined>();
    expectTypeOf<SkinGestures['longPress']>().toEqualTypeOf<GestureTarget | undefined>();
    expectTypeOf<SkinGestures['doubleTap']>().toEqualTypeOf<GestureTarget | undefined>();
    expectTypeOf<'presets'>().toMatchTypeOf<GestureTarget>();
    expectTypeOf<'openDetail'>().toMatchTypeOf<GestureTarget>();
    expectTypeOf<'action'>().toMatchTypeOf<GestureTarget>();
  });
});

describe('SupportReport (§8)', () => {
  it('carries skin/targetsContract/summary/widgets', () => {
    expectTypeOf<SupportReport['skin']>().toEqualTypeOf<string>();
    expectTypeOf<SupportReport['targetsContract']>().toEqualTypeOf<string>();
    expectTypeOf<SupportReport>().toHaveProperty('summary');
    expectTypeOf<SupportReport>().toHaveProperty('widgets');
  });
});

describe('Layering & Komposition (v1.9) — additive, skin-honored', () => {
  it('WidgetPosition is a pixel/raster box', () => {
    expectTypeOf<WidgetPosition['x']>().toEqualTypeOf<number>();
    expectTypeOf<WidgetPosition['y']>().toEqualTypeOf<number>();
    expectTypeOf<WidgetPosition['w']>().toEqualTypeOf<number>();
    expectTypeOf<WidgetPosition['h']>().toEqualTypeOf<number>();
  });

  it('PageKind covers normal/popup/globalInclude', () => {
    expectTypeOf<'normal'>().toMatchTypeOf<PageKind>();
    expectTypeOf<'popup'>().toMatchTypeOf<PageKind>();
    expectTypeOf<'globalInclude'>().toMatchTypeOf<PageKind>();
  });

  it('a LayerItem references a device by id with an optional role + position', () => {
    expectTypeOf<LayerItem['id']>().toEqualTypeOf<string>();
    expectTypeOf<LayerItem['role']>().toEqualTypeOf<Role | undefined>();
    expectTypeOf<LayerItem['position']>().toEqualTypeOf<WidgetPosition | undefined>();
  });

  it('a PageLayer is an ordered stack of items with an origin', () => {
    expectTypeOf<PageLayer['origin']>().toEqualTypeOf<'global' | 'include' | 'own'>();
    expectTypeOf<PageLayer['order']>().toEqualTypeOf<number>();
    expectTypeOf<PageLayer['items']>().toEqualTypeOf<readonly LayerItem[]>();
  });

  it('a PopupDescriptor carries optional position + modal/animation/auto-close hints', () => {
    expectTypeOf<PopupDescriptor['id']>().toEqualTypeOf<string>();
    expectTypeOf<PopupDescriptor['position']>().toEqualTypeOf<WidgetPosition | undefined>();
    expectTypeOf<PopupDescriptor['autoCloseMs']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<PopupDescriptor['modal']>().toEqualTypeOf<boolean | undefined>();
  });
});

describe('Page renderer & host seam (v1.10) — additive, skin owns appearance', () => {
  it('NavNode is a recursive nav hierarchy node', () => {
    expectTypeOf<NavNode['id']>().toEqualTypeOf<string>();
    expectTypeOf<NavNode['type']>().toEqualTypeOf<'LOCATION' | 'PAGE'>();
    expectTypeOf<NavNode['children']>().toEqualTypeOf<readonly NavNode[]>();
  });

  it('PageHost exposes nav state + services + host tile rendering', () => {
    expectTypeOf<PageHost['navTree']>().toEqualTypeOf<readonly NavNode[]>();
    expectTypeOf<PageHost['currentPageId']>().toEqualTypeOf<string | null>();
    expectTypeOf<PageHost['navigate']>().toEqualTypeOf<(pageId: string) => void>();
    expectTypeOf<PageHost['openPopups']>().toEqualTypeOf<readonly PopupDescriptor[]>();
    expectTypeOf<PageHost>().toHaveProperty('layersFor');
    expectTypeOf<PageHost>().toHaveProperty('renderTile');
  });

  it('PageHost resolves page links FOR the skin (v1.12) — the skin never navigates', () => {
    expectTypeOf<PageHost['resolveLink']>().toEqualTypeOf<(link: PageLink) => LinkOutcome>();
    expectTypeOf<PageHost['followLink']>().toEqualTypeOf<(link: PageLink) => LinkOutcome>();
    expectTypeOf<PageHost['isLinkActive']>().toEqualTypeOf<(link: PageLink) => boolean>();
    expectTypeOf<PageHost['linkLabel']>().toEqualTypeOf<(link: PageLink) => string>();
  });

  it('PageRenderer takes a PageHost and returns a framework node (like Renderer)', () => {
    expectTypeOf<PageRenderer>().toEqualTypeOf<(host: PageHost) => string | unknown>();
  });
});

describe('Page links (v1.11) — additive, ignorable, data only (#1194)', () => {
  it('PageLink carries the target node id + an optional active indicator', () => {
    expectTypeOf<PageLink['targetNodeId']>().toEqualTypeOf<string>();
    expectTypeOf<PageLink['activeIndicator']>().toEqualTypeOf<LinkIndicator | undefined>();
  });

  it('LinkIndicator mirrors the V1 link widget active_indicator options', () => {
    expectTypeOf<'none'>().toMatchTypeOf<LinkIndicator>();
    expectTypeOf<'dot'>().toMatchTypeOf<LinkIndicator>();
    expectTypeOf<'bar'>().toMatchTypeOf<LinkIndicator>();
    expectTypeOf<'border'>().toMatchTypeOf<LinkIndicator>();
  });

  it('a LayerItem carries an OPTIONAL link — without it the item is unchanged', () => {
    expectTypeOf<LayerItem['link']>().toEqualTypeOf<PageLink | undefined>();
    // Additive: the pre-1.11 shape still satisfies LayerItem.
    expectTypeOf<{ id: string }>().toMatchTypeOf<LayerItem>();
  });

  it('the contract only DESCRIBES the jump — it executes nothing (golden rule 7)', () => {
    // PageLink is plain data: every member is a string/union, never a function.
    expectTypeOf<PageLink>().toEqualTypeOf<{
      readonly targetNodeId: string;
      readonly activeIndicator?: LinkIndicator;
    }>();
  });
});

describe('Link resolution as a host service (v1.12) — the seam, not the logic', () => {
  it('LinkOutcome is the three-way result of a resolution', () => {
    expectTypeOf<LinkOutcome>().toEqualTypeOf<LinkNavigate | LinkGate | LinkUnknown>();
    expectTypeOf<LinkNavigate['kind']>().toEqualTypeOf<'navigate'>();
    expectTypeOf<LinkGate['kind']>().toEqualTypeOf<'gate'>();
    expectTypeOf<LinkUnknown['kind']>().toEqualTypeOf<'unknown'>();
  });

  it('a gate names the gated PAGE and the node the PIN session is scoped to', () => {
    expectTypeOf<LinkGate['pageId']>().toEqualTypeOf<string>();
    expectTypeOf<LinkGate['accessNodeId']>().toEqualTypeOf<string>();
  });

  it('the outcome is DATA — no member executes anything (golden rule 7)', () => {
    expectTypeOf<LinkNavigate>().toEqualTypeOf<{
      readonly kind: 'navigate';
      readonly pageId: string;
    }>();
    expectTypeOf<LinkUnknown>().toEqualTypeOf<{
      readonly kind: 'unknown';
      readonly targetNodeId: string;
    }>();
  });
});
