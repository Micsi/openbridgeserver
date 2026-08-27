# Visu – Positions-Presets & skin-eigenes Gesten-Modell (Contract 1.6/1.7)

> Feature-/Architektur-Dokument für den obs-Visu-Sprint. Zielgruppe: Agent/Entwickler,
> der das System erweitert – insbesondere wer einen **zweiten Skin mit eigenem
> Gesten-Modell** oder weitere positionsbasierte Preset-Typen bauen will.
>
> Status: **umgesetzt, committet, integriert** in `integ/authz-upstream` (App-Arbeitslinie).
> In 4 Wellen geliefert, je Gates grün, je 2 unabhängige Kritiker-Runden (quality-loop) bestanden.
> Contract-Details stehen knapp im CHANGELOG (`packages/contract/CHANGELOG.md`, Einträge
> **[1.6.0]** und **[1.7.0]**) – hier **nicht** dupliziert, sondern eingeordnet und um die
> App-/Skin-Architektur ergänzt.

## 1. Was das Feature liefert

Zwei zusammengehörige, aber unabhängige Bausteine:

1. **Positions-Presets für Beschattung** – konfigurierte feste Positionen (z. B. „Lüften",
   „Halb", „Beschattung") werden als Schnellzugriff angefahren, ohne Umweg über das Detail.
   Datengrundlage im Contract (1.6), datengetriebener Preset-Renderer im ionic-Skin,
   `applyPreset`-Dispatch im Host.
2. **Skin-eigenes Gesten-Modell** – ein Skin bringt sein Interaktionsmodell (welche Geste
   löst welches Ziel aus) als **deklarative Manifest-Daten** mit (1.7). Der Host wendet es an;
   der Renderer bleibt zustandslos.

Beide Contract-Erweiterungen sind **additiv/optional** und nirgends `required`. Skins ohne
Preset-Daten oder ohne `gestures`-Deklaration bleiben unverändert gültig (rückwärtskompatibel).

## 2. Preset-Datenmodell (Contract 1.6)

Neuer Typ und typ-spezifisches optionales Feld (Details/Semver siehe CHANGELOG **[1.6.0]**;
Quelle `packages/contract/src/types.ts`):

```ts
interface PositionPreset { readonly label: string; readonly position: number; readonly slat?: number }
```

- `presets?: readonly PositionPreset[]` liegt **typ-spezifisch** auf `BlindDevice` und
  `JalousieDevice` (nicht auf `DeviceBase`) – positionsbasiert, zukunftsoffen für weitere
  positionsbasierte Typen.
- `slat` nur für Lamellen-Jalousien; Rolladen lassen es weg.
- `label` kommt roh aus der Gerätekonfiguration (kein i18n-Key, analog `dev.label`/`dev.room`).

### `applyPreset`-Semantik

`WidgetAction 'applyPreset'` fährt `presets[index]` **atomar** an. Die Auflösung besitzt der
Host (`apps/visu/src/skin-host/actions.ts`, `case 'applyPreset'`):

| Schritt | Verhalten |
|---|---|
| Gerät auflösen | `store.byId(id)`; nur `blind`/`jalousie`, sonst no-op |
| Preset auflösen | `dev.presets[arg]`; fehlender/Out-of-range-Index ⇒ no-op |
| Position | **immer** `store.setPosition(id, preset.position)` |
| Slat | **nur** bei `jalousie` **und** `preset.slat != null` ⇒ `store.setSlat(id, preset.slat)` |

Der Intent trägt nur den **Index** (`data-arg`), nie Positions-/Lamellenwerte. Der Host löst
Position/Lamelle aus den Daten auf – deshalb rendern blind und jalousie den Preset-Baustein
**identisch** (siehe §4). „Nie eine stille Lampe": ein nicht auflösbarer Preset schreibt nichts.

## 3. Skin-eigenes Gesten-Modell (Contract 1.7)

Das Interaktionsmodell eines Skins ist **Manifest-DATEN**, kein Code (Kerngebot Daten=JSON,
Verhalten=Code). Neue Typen (Quelle `packages/contract/src/types.ts`, Details CHANGELOG **[1.7.0]**):

```ts
type GestureTarget = 'action' | 'openDetail' | 'presets';
interface SkinGestures { readonly tap?: GestureTarget; readonly longPress?: GestureTarget; readonly doubleTap?: GestureTarget }
interface SkinManifest { /* … */ readonly gestures?: SkinGestures }
```

### GestureTargets (was der Host je Geste anwendet)

| Target | Wirkung im Host |
|---|---|
| `action` | Führt die vom **getippten Element** markierte `data-action` aus. `openDetail` ist Shell-Sache (Host öffnet das Modal), jede andere Aktion ist ein kanonischer Core-Write an den Store. |
| `openDetail` | Öffnet die Detailfläche – **Kachel-Ebene, elementunabhängig** (nicht an eine `data-action` gebunden). |
| `presets` | Öffnet das Positions-Preset-Popover. **Fallback `openDetail`**, wenn das Gerät keine Presets trägt oder der Host kein `openPresets` bietet. Die Fallback-Politik liegt im Host. |

Kernunterscheidung: `action` respektiert, **welches Element** getippt wurde (der Skin markiert
`data-action` je Element); `openDetail`/`presets` wirken auf die **ganze Kachel** unabhängig vom
getroffenen Element.

### Default und Anwendung (Host)

Der Host (`apps/visu/src/pages/OverviewGrid.ts`) merged die Skin-Deklaration über einen
rückwärtskompatiblen Default:

```ts
const DEFAULT_GESTURES = { tap: 'action', longPress: 'openDetail' } as const;
const gestures = { ...DEFAULT_GESTURES, ...(skin.manifest.gestures ?? {}) };
```

- Ohne `gestures` im Manifest gilt das Vor-1.7-Verhalten: Tap führt die markierte Aktion aus,
  Long-Press öffnet das Detail, kein Double-Tap.
- Der Host erkennt die Gesten über die Composables `useLongPress` und `useDoubleTap`
  (`apps/visu/src/core/`) und ruft für jede Geste **eine** zentrale Funktion `applyGesture(target, id, ev)`.
- Eine vom Skin **nicht** deklarierte Geste (`undefined`) ist ein no-op (z. B. Double-Tap im Default).

## 4. Architektur-Grenze Skin ↔ Host

Das ist die tragende Aussage des Features (hält Goldene Regel 4 „Skin besitzt keinen State"
und das Kerngebot Daten=JSON/Verhalten=Code):

| Zuständigkeit | Skin (zustandsloser Renderer + Manifest-Daten) | Host (`apps/visu`) |
|---|---|---|
| Markup | erzeugt Markup, markiert `data-action`/`data-arg` je Element | – |
| „Welches Element trägt welche Aktion" | **Skin** (Renderer-Entscheidung) | – |
| „Welche Geste löst welches Ziel aus" | **Skin-Manifest-Daten** (`gestures`) | wendet sie an |
| Gesten-Erkennung | – | `useLongPress`/`useDoubleTap`, `applyGesture` |
| State/Store-Writes | nie | `setPosition`/`setSlat`/… via `dispatchIntent` |
| Modal/Popover | nie | `DetailModalHost.vue` (Detail **und** Preset-Popover) |

Der Skin besitzt **keinen** State und **keine** Gesten-Logik. Er sagt nur, welches Element
welche Aktion trägt (Markup) und welches Interaktionsmodell er möchte (Daten). Alles Verhalten
– Gesten-Erkennung, Ziel-Anwendung, Store-Writes, Overlays – liegt im Host.

### ionic-Preset-Renderer (im Skin-Repo `Micsi/obs-visu-skins`)

Nicht in dieser App-Arbeitslinie, sondern im separaten Skins-Repo
(`packages/skins/ionic/`):

- **EIN** generischer, zustandsloser Renderer `src/presets/PositionPresets.ts`. blind und
  jalousie rendern identisch, weil der `applyPreset`-Intent nur den Index trägt.
- Dritte `RendererMap presets` in `renderers.ts` neben `tiles`/`details`
  (`{ blind: positionPresets, jalousie: positionPresets }`).
- Ein Preset-Button markiert `data-action="applyPreset" data-arg="<index>"`. Gesperrt
  (`locked`) oder nicht schreibbar (`writable === false`) ⇒ Button inert (disabled +
  aria-disabled) und **ohne** `data-action` (kein Intent-Leak).
- Das früher hartcodierte `BlindDetail`-Preset-Muster ist damit **datengetrieben** (aus
  `device.presets`).

### Host-Integration (in dieser Arbeitslinie)

- `applyPreset`-Dispatch: `apps/visu/src/skin-host/actions.ts` (liest
  `store.byId(id).presets[arg]` → `setPosition` (+ `setSlat`), siehe §2).
- Preset-`ion-popover`: **bewusst in `apps/visu/src/app/DetailModalHost.vue` integriert**
  (kein separater Host). Nutzt `skin.presets[type]` genau wie `detailBody` `skin.details[type]`
  nutzt; ein Preset-Tap ist eine Einmalwahl und schließt das Popover danach.
- Gesten-Verdrahtung + `DEFAULT_GESTURES`: `apps/visu/src/pages/OverviewGrid.ts`.
- Neues Composable `useDoubleTap` (analog `useLongPress`): `apps/visu/src/core/useDoubleTap.ts`.

## 5. ionic-Gesten-Modell und Interaktions-Matrix

Der ionic-Skin deklariert im Manifest (`packages/skins/ionic/manifest.json`,
`targetsContract: "1.7"`):

```json
"gestures": { "tap": "action", "longPress": "presets", "doubleTap": "openDetail" }
```

Wirkung je Geste:

| Geste | Target | Verhalten |
|---|---|---|
| Single-Tap | `action` | Führt die vom getippten Element markierte `data-action` aus. Ein Bedienelement wird bedient; eine rein anzeigende Kachel (Rolladen), die `openDetail` trägt, öffnet so das Detail – für Maus, Touch **und** Tastatur. |
| Long-Press | `presets` | Preset-Popover (Fallback Detail, wenn keine Presets). |
| Double-Tap | `openDetail` | Detail öffnen. |

### Matrix je Kacheltyp (ionic-Modell)

Single-Tap hängt davon ab, welche `data-action` der Skin auf dem getippten Element markiert:

| Kacheltyp | markierte `data-action` (Beispiel) | Single-Tap | Long-Press | Double-Tap |
|---|---|---|---|---|
| light / switch (Bedienelement) | `toggle` auf dem Control | schaltet (`toggle`) | Detail (keine Presets ⇒ Fallback) | Detail |
| blind / jalousie (anzeigende Kachel) | `openDetail` auf der Kachel | öffnet Detail | **Preset-Popover** | Detail |
| blind / jalousie gesperrt/readonly | keine (`data-action` entfällt) | no-op (kein Intent) | Fallback Detail (keine schreibbaren Presets) | Detail |
| sensor (read-only) | keine schreibende Aktion | ggf. Detail, sonst no-op | Fallback Detail | Detail |

> „Bedienelement bedienen vs. Detail öffnen" ist also keine Typ-Fallunterscheidung im Host,
> sondern ergibt sich daraus, welche `data-action` der Skin je Element markiert – der Host
> führt bei `action` schlicht die markierte Aktion aus.

## 6. Einen zweiten Skin mit eigenem Gesten-Modell bauen

1. **`gestures` im Manifest deklarieren** (optional). Weglassen ⇒ `DEFAULT_GESTURES`
   (`tap:action`, `longPress:openDetail`). Nur die drei Slots `tap`/`longPress`/`doubleTap`
   existieren; jeder ist ein `GestureTarget`.
2. **`data-action`/`data-arg` je Element markieren.** Für `action`-Gesten entscheidet der Skin,
   welches Element welche Aktion trägt. Gesperrte/nicht-schreibbare Controls ohne `data-action`
   rendern (kein Intent-Leak).
3. **Presets nur, wenn gewünscht.** Ein `presets`-Target ohne `presets`-Renderer bzw. ohne
   `device.presets` fällt auf `openDetail` zurück – das ist gewollt, kein Fehler.
4. **Kein State, keine Gesten-Logik im Skin.** Erkennung/Anwendung bleibt im Host; neue
   Ziel-Verhalten kämen als neuer `GestureTarget` im Contract (Semver-Minor) plus ein Zweig in
   `applyGesture`, nicht als Skin-Code.
5. **Goldene Regeln** (`CONTRIBUTING-visu.md` §Goldene Regeln) gelten: Renderer nach Typ
   adressiert, `unsupported` als Pflichtangabe, AA-Kontrast, Daten=JSON/Verhalten=Code.

## 7. Verweise

- Contract-Diff/Semver: `packages/contract/CHANGELOG.md` → **[1.6.0]**, **[1.7.0]**.
- Contract-Typen: `packages/contract/src/types.ts`
  (`PositionPreset`, `BlindDevice`/`JalousieDevice.presets`, `WidgetAction`,
  `GestureTarget`, `SkinGestures`, `SkinManifest.gestures`).
- Host: `apps/visu/src/pages/OverviewGrid.ts` (Gesten + `DEFAULT_GESTURES` + `applyGesture`),
  `apps/visu/src/skin-host/actions.ts` (`applyPreset`),
  `apps/visu/src/app/DetailModalHost.vue` (Detail- **und** Preset-Popover),
  `apps/visu/src/core/useDoubleTap.ts`, `apps/visu/src/core/useLongPress.ts`.
- ionic-Skin (Repo `Micsi/obs-visu-skins`, `packages/skins/ionic/`):
  `src/presets/PositionPresets.ts` (generischer Preset-Renderer),
  `renderers.ts` (`RendererMap presets`), `manifest.json` (`gestures`, `targetsContract: "1.7"`).
- Workflow/Goldene Regeln: `CONTRIBUTING-visu.md`. Design-System-Stand/Backlog:
  `CONTRIBUTING-visu-designsystem.md`.
</content>
</invoke>
