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

## [1.13.0] – 2026-09-03

v1.13: **Palette-Deklarationsfläche für die AA-Messung** (Micsi/obs-visu-skins#12).

Der Konformitäts-Generator mass bis hierher zwei Achsen — Render und Aktion — und
**keine Farbe**: er kennt das Stylesheet eines Skins nicht. AA wurde deshalb
skin-seitig gemessen (terminal hatte einen eigenen Kontrast-Test), stand also
nirgends im Artefakt. Goldene Regel 6 verlangt AA aber verbindlich, auch an den
Tweak-Extremen — und ohne Vertrags-Fläche war ein Skin, der seine Palette prüft,
von einem, der es nicht tut, im Report nicht zu unterscheiden (Goldene Regel 3).

**Neu (additiv, alle Felder optional ⇒ Minor):**

- `SkinManifest.a11y?: SkinA11y` — der Skin deklariert die **Semantik** seiner
  Farben: Stylesheet(s), Theme-Selektoren, Gründe, Deckkräfte, Rolle je Token
  (`text` · `graphic` · `ground` · `exempt`) und die farbwirksamen Tweak-Achsen.
  Die **Werte** liest der Generator aus dem echten Stylesheet — deklariert wird,
  was ein Token TUT, gemessen wird, welche Farbe er HAT.
- `A11yTokenDecl` · `A11yGround` · `A11yTweakAxis` · `A11yRoleName` — die Teile
  dieser Deklaration. `exempt` verlangt `reason`: eine Auslassung ist eine
  Aussage, kein Vergessen. Deckkräfte stehen je Token (`A11yTokenDecl.alphas`)
  und nicht nur global: ein Skin dimmt seine gesperrte Kachel und seine
  Seitenüberschrift nicht — eine globale Liste erzeugte Paarungen, die es auf dem
  Schirm nie gibt, und ein Wächter mit falschem Alarm wird ignoriert.
- `SupportReport.a11y` ist von `Record<string, unknown>` auf den echten Typ
  `SupportA11y` geschärft, plus `A11yMeasurement` und `A11yFinding`.
  Drei Zustände statt zwei: `pass` · `fail` · `undeclared`.
- Schema-Block `a11y` mit den WCAG-Schwellen (`text` 4.5 · `graphic` 3) und dem
  Rollen-Vokabular. Das Tooling liest sie von dort, statt sie als Literal zu
  kopieren — dieselbe Blindheit, die `targetsContract` als Literal neun
  Minor-Versionen lang verdeckt hat.

**Nicht geändert:** kein bestehendes Feld, kein Renderer-Signatur-Bruch. Ein
1.12-Manifest bleibt typgültig; der Generator wertet ein fehlendes `a11y` aber als
`undeclared` und damit als Fehler — AA ist Pflicht, nicht Kür.

## [1.12.0] – 2026-09-03

v1.12: **Link-Auflösung als Host-Dienst an der Vertragsnaht** + ein
`honors`-Token für `link` (Micsi/openbridgeserver#146).

1.11 brachte `PageLink`/`LayerItem.link`, liess `PageHost` aber byteidentisch zu
1.10 – ein seitenbesitzender Skin hatte nur `navigate(pageId)`. Da
`PageLink.targetNodeId` ausdrücklich auch eine **LOCATION** nennen darf und der
Doc-Block zugleich sagt, LOCATION-Abstieg, PIN-Gate und Aktiv-Zustand seien
**Host**-Verhalten, blieb dem Skin nur, den `navTree` selbst abzusteigen – genau
das, was Goldene Regel 4 verbietet. Dieser Selbstwiderspruch ist behoben.

**Neu (additiv, optional-frei nur an `PageHost`):**

- Typen `LinkNavigate` · `LinkGate` · `LinkUnknown` · `LinkOutcome` – das
  dreiwege-Ergebnis einer Auflösung als Datentyp.
- `PageHost.resolveLink(link)` – auflösen ohne zu handeln (Affordanz).
- `PageHost.followLink(link)` – auflösen UND die kanonische Aktion ausführen.
- `PageHost.isLinkActive(link)` – Ziel = aktuelle Seite oder Vorfahr davon.
- `PageHost.linkLabel(link, outcome?)` – der zugängliche Name der
  Sprung-Affordanz (WCAG 4.1.2); die Navigation gehört dem Host, also auch ihre
  Beschriftung. Wird das `outcome` mitgegeben, nennt der Name auch den
  **Zustand**: ein PIN-gesperrtes Ziel sagt das im Namen. Ohne diesen Kanal wäre
  der Unterschied nur Cursor oder Farbe – für Touch und Screenreader also gar
  nicht vorhanden.
- `honors`-Vokabular: neuer Token `'link'`, und die Liste steht ab jetzt in
  `contract.schema.json → layoutHonors`
  (`order`·`grouping`·`role`·`position`·`nav`·`layers`·`popup`·`link`). `'link'` ist NICHT
  in `'layers'` enthalten: ein Skin kann Layer honorieren und `link` trotzdem
  fallenlassen – ohne eigenen Slot wäre „rendert Links" von „verschluckt Links
  still" im `support.json` nicht unterscheidbar (Goldene Regel 3).
  Die Liste ist **durchgesetzt**, nicht nur dokumentiert: der Konformitätslauf
  der Skins lehnt einen unbekannten String ab und verlangt bei `'link'`, dass
  der Page-Renderer eine aktivierbare Sprung-Affordanz auch wirklich zeichnet –
  sonst stünde nach dem Rückzug des Hosts gar keine mehr da.

Der Vertrag typisiert die Naht, er füllt sie nicht (Goldene Regel 7): die
Auflösung selbst liegt unverändert im Host (`apps/visu/src/core/links.ts`).
Minor-Bump: reine Typen-Zugabe, keine Device-Datenform-Änderung. Ein Skin ohne
Page-Renderer ist unberührt; ein Skin mit Page-Renderer erhält vier zusätzliche
Mitglieder, die er ignorieren darf.

> **⚠ Erwartet rot bis beide Seiten landen.** Wie bei 1.11 prüft
> `apps/visu/tests/ionic-skin-link.test.ts` `targetsContract === version`; der
> Wächter ist bis zum Skin-Nachzug rot (`expected '1.11' to be '1.12'`).
> Nachzuziehen in `Micsi/obs-visu-skins`: `ionic` und `edomi` auf
> `targetsContract: "1.12"`. `edomi` nimmt zusätzlich `honors: [… "link"]` auf
> und rendert die Sprung-Affordanz über die neuen `PageHost`-Mitglieder.

## [1.11.0] – 2026-09-02

v1.11: **Seiten-Verlinkung auf platzierten Elementen** (Upstream #1194). Ein
Element ohne eigene Klick-Funktion – der Autor nennt kleine Kamera-Kacheln –
soll auf eine andere Visuseite springen können, „wie im Link-Widget". Neue
**optionale, additive** Typen: `PageLink` (`targetNodeId` – die Entsprechung von
`target_node_id` im V1-Link-Widget – plus `activeIndicator`) und `LinkIndicator`
(`none`/`dot`/`bar`/`border`, gespiegelt vom V1-`active_indicator`). `LayerItem`
trägt dazu das neue optionale Feld `link?: PageLink`.

Reine Daten (Goldene Regel 7): der Vertrag sagt nur, WOHIN gesprungen wird. Das
Auflösen der Access-Kette (`parent_id`), das PIN-Gate eines `protected` Knotens,
der Abstieg von einer LOCATION auf ihre erste sichtbare Seite und der
Aktiv-Zustand entlang der Vorfahrenkette sind **Host**-Verhalten – der Skin
besitzt weder Zustand noch Navigationslogik (Goldene Regel 4). Minor-Bump: reine
Typen-Zugabe, keine Device-Datenform-Änderung. Ohne `link` verhält sich jedes
platzierte Element exakt wie bisher.

> **⚠ Erfordert einen Skin-Nachzug, bevor dieser Stand gemerged wird.**
> „Additiv" heisst hier nur *verhaltensmässig* additiv – es befreit **nicht** von
> der Versionskopplung. Der repo-eigene Wächter
> `apps/visu/tests/ionic-skin-link.test.ts` prüft `targetsContract === version`
> und ist gebaut, um bei **jedem** Bump rot zu werden, bis der Skin nachzieht.
> Seit diesem Bump ist er rot (`expected '1.10' to be '1.11'`).
>
> Nachzuziehen im Repo `Micsi/obs-visu-skins`: **`ionic` und `edomi` auf
> `targetsContract: "1.11"`**. Beide Skins müssen dafür nichts implementieren –
> `LayerItem.link` ist optional und der Host führt die Navigation aus –, es ist
> reine Versionspflege. (`terminal` hat `'1.1'` hartkodiert und wird von seinem
> Wächter nicht geprüft; nur relevant, falls dieser scharf gestellt wird.)

## [1.10.0] – 2026-09-01

v1.10: der **Page-Renderer-Seam** (CONTRIBUTING-visu-layering.md, W3c/W4). Ein Skin
kann optional eine ganze Seite besitzen (Navigation + komponierte Layer + Popups),
nicht nur Kacheln. Neue **optionale, additive** Typen: `NavNode` (Navigations-
Hierarchie), `PageHost` (die Host-Dienste, die ein Page-Renderer bekommt – `navTree`,
`currentPageId`, `navigate`, `layersFor`, `renderTile`, `openPopups`, `openPopup`,
`closePopup`) und `PageRenderer = (host: PageHost) => string | unknown` (wie
`Renderer` framework-agnostisch; der Contract typisiert die Seam, führt nichts aus).
Der Host besitzt weiter STATE (aktuelle Seite, offene Popups, Auto-Close-Timer) und
rendert die Content-Kacheln; der Skin besitzt die ERSCHEINUNG. Minor-Bump: reine
Typen-Zugabe, keine Device-Datenform-Änderung. Ein Skin ohne Page-Renderer ist
unverändert; ein Skin mit einem zieht sein `targetsContract` auf 1.10.

## [1.9.0] – 2026-09-01

v1.9: Seiten-Layering & Komposition als **Skin-Fähigkeit** (CONTRIBUTING-visu-layering.md,
Upstream #1195). Neue **optionale, additive** Typen, die der Host liefert und ein Skin nur
honoriert, wenn er sie deklariert: `WidgetPosition` (`x/y/w/h`, Pixel-Layout à la Edomi),
`PageKind` (`normal`/`popup`/`globalInclude`), `LayerItem` + `PageLayer` (geordneter
Layer-Stack aus globalen/individuellen Includes + eigenem Inhalt) und `PopupDescriptor`
(modale Overlay-Seite mit Position/Auto-Close/Modal/Animation/Schatten/Abdunkeln).
`SkinLayout.honors` erkennt zusätzlich `'position'`, `'layers'`, `'popup'`. Minor-Bump: reine
Typen-Zugabe, keine Device-Datenform-Änderung. Bestehende Skins bleiben gültig und
unverändert (der responsive ionic-Skin honoriert nichts davon); ein Pixel-/Overlay-Skin
zieht sein `targetsContract` auf 1.9 und deklariert die passenden `honors`.

## [1.8.0] — 2026-08-28

v1.8: neuer Ctx-Helfer `floorShort(d)` – der Host verdichtet den vollen Geschossnamen
(`DeviceBase.floor`, z. B. „Erdgeschoss") auf sein Kürzel („EG"), damit ein Skin den
Eyebrow als „<Kürzel> <Raum>" zeigen kann. Reine Host-/Core-Datenableitung
(Verhalten=Code, Goldene Regel 7); der Skin besitzt kein Mapping. Minor-Bump: die
Helfer-Oberfläche wächst, die Device-Datenform bleibt unverändert. Bestehende Skins
bleiben gültig; ein Skin, der `floorShort` nutzt, zieht sein `targetsContract` auf 1.8.

## [1.7.0] — 2026-08-27

v1.7: `SkinManifest.gestures` – ein Skin bringt sein eigenes Gesten-/Interaktionsmodell
mit (welche Geste welches Ziel auslöst). Rein deklarative Daten; der Renderer bleibt
zustandslos, die Gesten-Erkennung und -Anwendung besitzt weiterhin der Host.

### Added

- **`GestureTarget` (§7):** `'action' | 'openDetail' | 'presets'` – das Ziel-Verhalten,
  das der Host für eine Geste anwendet (`action` = die markierte `data-action` ausführen).
- **`SkinGestures` (§7):** `{ tap?; longPress?; doubleTap? }` je `GestureTarget`.
- **`SkinManifest.gestures` (§7):** additives optionales Feld. Fehlt es, nutzt der Host
  einen rückwärtskompatiblen Default. Additive Minor-Änderung (§9): bestehende Skins und
  die App bleiben gültig. Keine Änderung an der Device-Datenform; `contract.schema.json`
  und `fixtures` ziehen nur die Versionsnummer auf `1.7` nach.

## [1.6.0] — 2026-08-27

v1.6: `PositionPreset` + `presets` für positionsbasierte Geräte (Rolladen/Jalousie) plus
die Aktion `applyPreset` – Datengrundlage für konfigurierte feste Positionen, die in der
Visu per Long-Press als Schnellmenü angefahren werden (ohne Umweg über das Detail).

### Added

- **`PositionPreset` (§3):** neuer Typ `{ label: string; position: number; slat?: number }`.
  `slat` nur für Lamellen-Jalousien; `label` kommt aus der Gerätekonfiguration (roh gerendert).
- **`BlindDevice`/`JalousieDevice` (§3):** additives optionales Feld `presets`
  (`readonly PositionPreset[]`). Typ-spezifisch auf den positionsbasierten Geräten (nicht
  `DeviceBase`), zukunftsoffen für weitere positionsbasierte Typen. Additive Minor-Änderung
  (§9): bestehende Skins und die App bleiben unverändert gültig.
- **Aktionen (§6):** `WidgetAction` um `applyPreset` erweitert – fährt `presets[index]`
  atomar an (Position + optional Lamelle in einem Intent). Deklariert bei `blind`/`jalousie`.
- **Schema/Fixtures:** `contract.schema.json` deklariert `version: "1.6"`, ergänzt das
  `presets`-Array in den `dataSchema`s von `blind`/`jalousie` (nicht `required`) und
  `applyPreset` in deren `actions`. `fixtures` ziehen auf `contractVersion: "1.6"` nach
  (Preset-Beispiele bei `blind.half` und `jalousie.tilted`).

## [1.5.0] — 2026-08-26

v1.5: `DeviceBase.writable` – geräte-genaue Bedienbarkeit als Datengrundlage für die
authz-/readonly-Durchsetzung in der Visu (gesperrte Controls bei fehlendem Write-Recht
oder readonly-Seite).

### Added

- **DeviceBase (§3):** additives optionales Feld `writable` (`boolean`) für **alle**
  Device-Typen. `undefined`/`true` = bedienbar (Default, rückwärtskompatibel), `false` =
  vom Host als nicht-schreibbar markiert (readonly-Seite **oder** fehlendes Write-Recht) —
  die Skin rendert die Controls dann gesperrt. Die Auswertung liefert der Host; die
  Renderer-Nutzung folgt in einer eigenen Welle. Additive Minor-Änderung (§9): bestehende
  Skins und die App bleiben unverändert gültig.
- **Schema/Fixtures:** `contract.schema.json` deklariert `version: "1.5"` und ergänzt
  `writable` in den `dataSchema`s aller Kern-Typen (analog `floor`). `fixtures` ziehen auf
  `contractVersion: "1.5"` nach (ein `writable: false`-Beispiel bei `switch.off`).

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

[1.5.0]: https://github.com/Micsi/openbridgeserver/tree/feat/visu-mobile-skins/packages/contract
[1.4.0]: https://github.com/Micsi/openbridgeserver/tree/feat/visu-mobile-skins/packages/contract
[1.3.0]: https://github.com/Micsi/openbridgeserver/tree/feat/visu-mobile-skins/packages/contract
[1.2.0]: https://github.com/Micsi/openbridgeserver/tree/feat/visu-mobile-skins/packages/contract
[1.1.0]: https://github.com/Micsi/openbridgeserver/tree/feat/visu-mobile-skins/packages/contract
[1.0.0]: https://github.com/Micsi/openbridgeserver/tree/feat/visu-mobile-skins/packages/contract
