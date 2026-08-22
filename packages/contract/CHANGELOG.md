# Changelog — `@obs/visu-contract`

Alle nennenswerten Änderungen am Vertrag werden hier dokumentiert. Der Vertrag koppelt
die obs-Visu-App und die Skins ausschließlich über **Daten (JSON) und Typen** — er führt
nichts aus (Goldene Regel 7).

Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.1.0/); die Versionierung
folgt der unten dokumentierten Semver-Policy (CONTRACT-v1.md §9).

## Semver-Policy (§9)

Eine Versionsänderung beschreibt immer einen Diff an der **Datenform** oder der **Typen-/
Aktions-Oberfläche**. Jeder Bump steht hier mit den neuen/geänderten Typen.

- **Patch (1.0.x):** Fixtures ergänzt, Doku — **keine** Formänderung. Bestehende Skins und
  die App bleiben unverändert gültig.
- **Minor (1.x):** neuer Widget-Typ **oder** neue *optionale* Felder/Aktionen. Bestehende
  Skins bleiben gültig; für neue Typen erscheinen sie in ihrer Fixture-Wand als `gap`, bis
  sie nachziehen oder den Typ bewusst als `unsupported` deklarieren.
- **Major (x):** Bruch an Datenform oder Aktion (entferntes/umbenanntes/typ-geändertes Feld,
  geänderte Aktionssemantik). Skins **müssen** ihr `targetsContract` anheben.

> Die Fixture-Wand eines Skin-Autors wird an genau den geänderten Stellen rot — das ist
> gewollt: ein Formbruch ist sichtbar, kein stiller Default (Goldene Regeln 2 + 3).

## [1.4.0] — 2026-08-22

v1.4: `climate` wird Kern-Typ; Sensor bekommt Zeitreihe/Icon; `Ctx.stateParts` und `DeviceBase.floor`
– die Datengrundlage für die Design-System-Vorlage (Klima/Heizung-Kachel, Verlaufs-Chart,
fett/gemutetes Zustandswort, Crumb-Pfad).

### Added

- **Stabiler Kern (§3):** `climate` (Klima/Heizung/RTR) rückt von *reserved* in den stabilen
  Kern auf (`CoreWidgetType`), mit `data`, `actions`, `icon`, `roles` und maschinell
  validierbarem `dataSchema` (`since: "1.4"`). Additive Minor-Änderung (§9): bestehende
  Skins bleiben gültig; solange sie `climate` weder rendern noch als `unsupported`
  deklarieren, erscheint der Typ in ihrer Fixture-Wand als `gap`.
  - `ClimateDevice` (read-only): `setpoint`, `current`, `mode` (`heat|cool|off|auto`), `unit`.
- **Aktionen (§6):** `WidgetAction` um `setSetpoint` (climate) erweitert.
- **Sensor (§3):** additive optionale Felder `icon` (Akzent-Icon analog `SceneDevice.icon`),
  `series` (`readonly number[]` — Verlauf/Chart), `min`, `max` (Fuß „min … · max …").
  Rückwärtskompatibel; `SensorDevice`-Bestand bleibt gültig.
- **DeviceBase (§3):** additives optionales Feld `floor` (Etagen-/Geschoss-Label für den
  Crumb-Pfad im Detail) — für **alle** Device-Typen.
- **Ctx (§5):** neuer Helfer `stateParts(d): { word, rest }` — trennt das Zustandswort
  (z. B. „Ein"/„Aus") vom Rest (z. B. „ — 45 %"), damit Skins das Wort fett und den Rest
  gemutet rendern (Vorlage: `<b>Ein</b> — 45 %`). `stateText` bleibt unverändert
  (rückwärtskompatibel); die Implementierung liefert der Host.
- **Schema/Fixtures:** `contract.schema.json` deklariert `version: "1.4"`, promotet den
  `climate`-Block und ergänzt die neuen Sensor-/Base-Felder in den `dataSchema`s. Da v1.4
  die Datenform ändert (neuer Kern-Typ + Felder), ziehen die `fixtures` auf
  `contractVersion: "1.4"` nach (neue `climate`-Zustände, angereicherte Sensor-Fixtures).

## [1.3.0] — 2026-06-12

v1.3: universelle **Host-Aktionen** (`openDetail` · `close` · `stop`-momentary) werden Vertragsbestandteil.

### Added

- **Host-Aktionen (§6):** neue Typen `HostUiAction` (`openDetail` | `close`) und
  `HostAction` (`WidgetAction | HostUiAction`). Sie benennen die **universellen**,
  vom Host-Shell behandelten Intents, die ein Skin auf `data-action` markieren darf,
  ohne sie pro Widget im Manifest zu deklarieren — denn sie sind kein kanonischer
  Core-Write. `openDetail`/`close` sind Navigation (Detail-Surface auf/zu); `stop` ist
  für die Bewegungs-Widgets (`blind`/`jalousie`) ein UI-only Momentary (kein Core-Write
  in v1) und bleibt zugleich kanonische Media-Transport-`WidgetAction`. Additive
  Minor-Änderung (§9): bestehende Skins und die App bleiben unverändert gültig.
- **Schema (§8):** `contract.schema.json` deklariert `version: "1.3"` und einen
  Top-Level-Block `hostActions` (`openDetail`/`close`/`stop`) als maschinenlesbares
  Pendant zu `HostAction` — die Datenform-Quelle für die universellen Host-Intents.
- **Fixtures (§4):** unverändert — v1.3 ändert keine Datenform (nur die Aktions-/Typen-
  Oberfläche), daher bleiben die `fixtures` auf `contractVersion: "1.2"`.

## [1.2.0] — 2026-06-12

v1.2: `camera` + `media` werden Kern-Typen (vorher reserved).

### Added

- **Stabiler Kern (§3):** `media` und `camera` rücken von *reserved* in den stabilen
  Kern auf (`CoreWidgetType`), je mit `data`, `actions`, `icon`, `roles` und einem
  maschinell validierbaren `dataSchema` (`since: "1.2"`). Additive Minor-Änderung (§9):
  bestehende Skins bleiben gültig; solange sie `media`/`camera` weder rendern noch als
  `unsupported` deklarieren, erscheinen die Typen in ihrer Fixture-Wand als `gap`.
  - `MediaDevice` (read-only): `playState` (`playing|paused|stopped`), `title`,
    `subtitle`, `volume` (0–100), optional `artUrl`.
  - `CameraDevice` (read-only): `online`, `snapshotUrl`, optional `streamUrl`.
- **Aktionen (§6):** `WidgetAction` um `playPause`, `stop`, `next`, `previous`,
  `setVolume` (media) und `refresh` (camera) erweitert.
- **Fixtures (§4):** `media: playing/paused/stopped`, `camera: online/offline`;
  `contractVersion` → `"1.2"`.
- **Schema/Exports:** `contract.schema.json` und `index.ts` deklarieren `version: "1.2"`.

## [1.1.0] — 2026-06-09

v1.1: Ctx.t (i18n) optional.

### Added

- **Ctx (§5):** optionale Methode `t?(key: string, params?: Record<string, unknown>): string`
  — ein vom Host injizierter Übersetzer. Additive Minor-Änderung (§9): bestehende Skins und
  die App bleiben gültig; Text-Helfer (z. B. `stateText`) nutzen `t`, wenn vorhanden, und
  fallen sonst auf die deutschen Kern-Literale zurück (rückwärtskompatibel).
- **Schema/Exports:** `contract.schema.json` und `index.ts` deklarieren `version: "1.1"`.
  Die `fixtures` bleiben auf `contractVersion: "1.0"` (keine Datenform-Änderung).

## [1.0.0] — 2026-06-09

Erste stabile Vertragsversion (`version: "1.0"`).

### Added

- **Globals (§2):** `roles` `[compact, default, wide, tall, feature, banner]` und die
  semantischen `iconSlots` (Default-Set aus `reference/vue-ionic/store.js → ICONS`).
- **Stabiler Kern v1 (§3):** Widget-Typen `light`, `switch`, `blind`, `jalousie`, `sensor`,
  `scene` — je mit `data`, `actions`, `icon`, `roles` und einem maschinell validierbaren
  `dataSchema`. Jalousie-Semantik: `position` 0=auf/100=zu, `slat` 0–100 ⇒ 0–90°, `locked`,
  `statuses[]` (`true|false|null`).
- **Reserved für v1.1 (§3):** `climate`, `weather`, `energy`, `chart`, `media`, `camera`,
  `alarm` im Schema deklariert (`reserved: true`), damit Skins sie bewusst abwählen
  (`unsupported`) können und der Generator sie nicht als `gap` fehlinterpretiert.
- **Fixtures (§4):** Musterzustände je Kern-Typ — `light: off/on/dimmed`, `switch: off/on`,
  `blind: open/half/locked`, `jalousie: open/tilted/locked`, `sensor: ok/warn`,
  `scene: film/morgen` — mit `contractVersion: "1.0"`. Accents sind Palette-Schlüssel,
  nie Hex.
- **Typen (§5/§7/§8):** `Device`-Union (schreibgeschützt) inkl. `LightDevice`,
  `SwitchDevice`, `BlindDevice`, `JalousieDevice`, `SensorDevice`, `SceneDevice`; `Tokens`;
  `Ctx` (`stateText`, `hyphenate`, `icon`, `nf`, `warn`) als Sandbox-Grenze; `Renderer`
  (`(d, t, ctx) => string | VNode`); `SkinManifest`; `SupportReport`.
- **Exports:** `index.ts` exportiert `schema`, `fixtures`, `version` (= `"1.0"`) und die
  Typen.

[1.4.0]: https://github.com/Micsi/openbridgeserver/tree/feat/visu-mobile-skins/packages/contract
[1.3.0]: https://github.com/Micsi/openbridgeserver/tree/feat/visu-mobile-skins/packages/contract
[1.2.0]: https://github.com/Micsi/openbridgeserver/tree/feat/visu-mobile-skins/packages/contract
[1.1.0]: https://github.com/Micsi/openbridgeserver/tree/feat/visu-mobile-skins/packages/contract
[1.0.0]: https://github.com/Micsi/openbridgeserver/tree/feat/visu-mobile-skins/packages/contract
