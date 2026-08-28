# Visu Design-System-Loop — Stand, Backlog & Integrationsplan

> Ergebnis des Quality-Loops „apps/visu-Renderer gegen die *VISU Design System*-Vorlage".
> Messlatte: `~/Downloads/Visu Design System (standalone).html` (optisch **und** funktional).
> Stand: konsolidiert. Der substanzielle Kern ist committed; Restpunkte + Landeanflug unten.

## 1. Erreicht (committed, Gates grün, V1/`frontend/` unberührt)

**Skin-Repo `obs-visu-skins` @ `feat/visu-designsystem-live`:**
- `3142b6d` Phase-A-Akzent-Fundament (vivide `--acc-bar` nur in der 4px-Topbar, AA-sicher; `accentStyle`-Default `bar`) + Renderer Licht/Schalter/Rolladen/Sensor-1×1 auf Vorlage-Niveau
- `73ff069` `targetsContract` → 1.4 + Contract-Link auf authz-integ konsolidiert
- `7a3beb8` ClimateTile+Detail (Sollwert via `setSetpoint`), Sensor-Chart (SVG-Sparkline aus `series` + min/max-Fuß), Sensor-Icon
- Gates: `tsc --build` grün · vitest 192/192 · eslint 0 · prettier clean

**App/Contract-Repo `openbridgeserver` @ `integ/authz-upstream`** (kumulativer Stack auf dem authz-Upstream-Merge):
- `1a3534e1` Host emittiert rohe `--vz-acc-*`-Deko-Tokens; `accentStyle`-Default `bar`
- `f17eb625` **Contract v1.4** (additiv/semver-minor): `ClimateDevice` (climate→core), `SensorDevice.series/min/max/icon`, `DeviceBase.floor`, `Ctx.stateParts`, `WidgetAction 'setSetpoint'` + Host-Anpassung (stateParts-Impl mit Invariante `word+rest===stateText`, climate in allen exhaustive-Records, Mock-Daten für alle Kern-Typen)
- Gates: `pnpm -r typecheck/build` grün · visu-app 311 Tests · contract 48 Tests · lint · Coverage · i18n-Parität

**Renderer-Typen auf Vorlage-Niveau:** Licht, Schalter, Rolladen, Jalousie(-Detail), Sensor 1×1, Sensor-Chart, Sensor-Icon, Klima (Tile+Detail). Fundament (Tokens/Akzent/Grid/Themes) + Contract-Datenschicht stehen.

**Positions-Presets + skin-eigenes Gesten-Modell (Contract 1.6/1.7) – umgesetzt & integriert:**
Beschattungs-Presets (`PositionPreset`/`presets`, Aktion `applyPreset`) und ein deklaratives,
skin-eigenes Interaktionsmodell (`SkinManifest.gestures`) sind in `integ/authz-upstream`
committet (4 Wellen, Gates grün, je 2 Kritiker-Runden). Der ionic-Skin fährt
`{ tap:'action', longPress:'presets', doubleTap:'openDetail' }`; das früher hartcodierte
Blind-Preset-Muster ist datengetrieben. Feature-/Architektur-Details, `applyPreset`-Semantik,
Skin↔Host-Grenze und Interaktions-Matrix: siehe **`CONTRIBUTING-visu-gestures-presets.md`**
(Contract-Diff im CHANGELOG **[1.6.0]/[1.7.0]**). Betrifft die Beschattungs-Tiles
funktional/interaktiv; die reine **Container-**Vereinheitlichung der Jalousie-Kachel bleibt die
separate Produktentscheidung B6 (siehe unten) – Presets/Gesten präjudizieren sie nicht.

## 2. Backlog — Stand 2026-08-28 (Quality-Loop verifiziert)

**Alle B-Punkte abgeschlossen:** B1 fetter Fuß ✔ (Klima-Fuß per Loop an Vorlage angeglichen, Commit `f820d20`; light/switch/blind/sensor waren bereits an der Vorlage — Kritiker-verifiziert). B2 Crumb-Pfad ✔ (bereits umgesetzt). B3 climate in Wall ✔ (bereits umgesetzt). B4 Gruppe-3 (Szene/Media/Kamera): **entfällt** — diese Typen kommen in der Vorlage gar nicht vor (keine Messlatte). B5 Conformance climate ✔ (`CORE_WIDGET_TYPES` enthält climate). B6 Jalousie ✔ (Entscheidung §2.1).



| # | Punkt | Ort | Aufwand |
|---|---|---|---|
| B1 | **Fetter Fuß** (`<b>Ein</b> — 45 %`) über alle Tile-Renderer via `ctx.stateParts` | ionic tiles | klein, alle Typen |
| B2 | **Crumb-Pfad** im Detail („Erdgeschoss · Mobil / Raum") via `DeviceBase.floor` | ionic details | klein |
| B3 | **climate in die Overview-Wall**: `DEFAULT_ROLE['climate']` → 2×2/feature + Wall referenziert die ClimateDevice (liegt aktuell im separaten `climateRooms`-Showcase) | apps/visu `model.ts` | klein |
| B4 | **Gruppe 3 Feinschliff**: Szene/Media/Kamera gegen Vorlage nachziehen (sind in der Wall, aber nicht explizit Loop-verifiziert) | ionic | mittel |
| B5 | **Conformance-Tool**: `packages/tooling/conformance` `CORE_WIDGET_TYPES` fest auf 8 Typen → climate ergänzen (sonst ignoriert der Generator climate; `support.json` derzeit von Hand) | packages/tooling | klein |
| B6 | **Jalousie-Tile** – **ENTSCHIEDEN** (siehe §2.1): bleibt bewusste Ausnahme (reiche In-Kachel-Bedienung), Hülle beim Akzent auf `vz-tile`-Parität gezogen, Lock bleibt typeigen. | ionic tiles + `ionic.css` | erledigt |

### 2.1 B6 – Entscheidung: Jalousie bleibt bewusste Ausnahme (Hülle angeglichen)

**Entscheidung:** Die Jalousie wird **nicht** auf das rein anzeigende `vz-tile`-Muster
umgebaut. Sie behält ihre reiche In-Kachel-Bedienung (vertikale Positions-Rail,
Lamellen-Slider + Schritt-Buttons, Fahr-Buttons auf/stop/ab). Angeglichen wird nur die
**typ-unabhängige Hülle beim Akzent**; der Lock-Mechanismus bleibt bewusst typeigen.

**Begründung:**
- **Der Unterschied ist das Interaktionsmodell, nicht der Container.** `vz-tile`-Kacheln
  (Rolladen/Licht/…) sind „anzeigen + Detail öffnen"; die Jalousie ist „direkt bedienen".
  Ein „Umbau auf `vz-tile`" hieße, die Direktbedienung von der Kachel zu **entfernen** und
  ins Detail zu verlagern – wo `JalousieDetail` sie ohnehin schon vollständig anbietet. Das
  wäre ein **Funktionsabbau auf der Kachel**, kein Refactoring (vgl. Memory-Regel „kein
  Funktionsabbau für real genutzte Features").
- **Kein Loop-Mandat:** Die Vorlage `Visu Design System (standalone).html` zeigt kein
  Jalousie-Widget. Es gibt also keine Messlatte, gegen die ein Umbau validiert werden könnte;
  der Loop ist als „Renderer *gegen die Vorlage*" definiert.
- **„Ein Container für alle" = eine Hülle, typ-adressierte Renderer** (Sprint-Kerngebot), nicht
  „alle Kacheln anzeigend". Eine reich bedienende Kachel ist ein anderer Renderer-Inhalt, keine
  Prinzipverletzung.

**Umgesetzter Hüllen-Angleich (`obs-visu-skins` @ `feat/visu-designsystem-live`):**
- `JalousieTile.ts`: Wrapper setzt zusätzlich `--acc-bar: var(--vz-acc-<key>)` (wie `BlindTile`);
  vivider Akzent läuft nur in die 4px-Deko-Topbar, Text/Icons behalten das AA-sichere `--acc`.
- `ionic.css`: additives `.jal-tile::before` (1:1-Port von `.vz-tile::before`, kontrast-exempt
  nach WCAG 1.4.11). Kein bestehender `.jal-*`-Selektor, keine Bedienlogik und kein Test berührt.
- Gates grün: `tsc --build` · vitest (jalousie-Spec + 199/200; der eine Rest-Fail war der
  damals vorbestehende `smoke.spec.ts`-Contract-Skew 1.4→1.5, inzwischen behoben) · eslint · prettier.

**Bewusst NICHT angeglichen – Lock:** `vz-lockveil` ist ein ganzflächiger Schleier
(`inset:0`, `pointer-events:none`) für rein anzeigende Kacheln. Die Jalousie sperrt gestuft
(dunkelt gezielt die Bedienzone ab, Fenster bleibt für `openDetail` tippbar). Das vz-Lock-Modell
auf eine bedienbare Kachel zu ziehen wäre semantisch schlechter, nicht kohärenter.

**Echter Trigger für einen späteren Vollumbau:** erst wenn die Vorlage ein Jalousie-Widget
erhält *oder* das Produkt entscheidet, dass die Jalousie auch „anzeigen + Detail" sein soll.

## 3. Integrationsplan (cross-repo-Landeanflug)

### 3.1 Worktree-/Link-Landkarte (aktuell, teils umgebogen)
- `apps/visu` (authz-integ) → Contract via `workspace:*` (authz-integ, **1.4**).
- ionic-Skin (`obs-visu-skins`) → Contract via `link:` auf **authz-integ** (1.4) — **umgebogen** (Original war `visu-integrate` 1.3); terminal-Skin ebenso nachgezogen.
- `apps/visu` → ionic via `link:` auf den **geteilten** `obs-visu-skins`-Worktree (nicht den entfernten `-designsystem`).
- **Vor Merge zurücksetzen/sauber verankern:** die `link:`-Pfade sind lokale Loop-Verkabelung, keine Commit-Wahrheit. Die `package.json`-Link-Umbiegungen (ionic `@obs/visu-contract`) sind **nicht** zu committen bzw. auf die kanonische Auflösung zu bringen.

### 3.2 Merge-Reihenfolge (Wächter-Pinning beachten — siehe Memory `visu-crossrepo-ci-pinning`)
Der App-Test `ionic-skin-link` erzwingt `manifest.targetsContract === contract.version`. Die App-CI löst `obs-visu-skins`@**main** ungepinnt auf. Daher zwingend:
1. **Skins zuerst:** `obs-visu-skins` `feat/visu-designsystem-live` (Contract-1.4-Renderer + `targetsContract:1.4`) nach `obs-visu-skins/main` mergen.
2. **Dann App:** die Contract-1.4-Welle (App) mergen. Zwischen 1 und 2 ist die Linie kurz rot (bekannt).

### 3.3 Branch-Lage — geklärt: alles Fork-intern, kein Upstream
**authz ist bereits Teil von Upstream `main`.** Der Merge `f737dfaa` in `integ/authz-upstream` ist daher reines **Einholen von Upstream in den Fork** (normale Fork-Pflege), kein separater Liefer-Track. Es gibt keine „authz-Welle" mehr zu trennen.

**Die Visu bleibt bis zur Fertigstellung ausschließlich im Fork** (U-Boot, AGENTS.md: kein Upstream-PR bis Release-Reife). Folgen:
- **Keine** Branch-Trennung authz↔Design-System nötig. `integ/authz-upstream` = aktueller Fork-Integrationsstand (Upstream `main` inkl. authz **+** Visu Contract 1.4 + Host). Es ist der natürliche, upstream-nahe Nachfolger von `feat/visu-mobile-skins`.
- **Kein** Upstream-PR jetzt. Der Landeanflug ist rein **Fork-intern** — es geht nur darum, dass die Fork-CI grün ist und die Arbeitsbasis konsolidiert bleibt.

### 3.4 Fork-interne Konsolidierung (wenn gewünscht)
1. **Skins zuerst** (Wächter, §3.2): `obs-visu-skins` `feat/visu-designsystem-live` (ionic Contract-1.4-Renderer, `targetsContract:1.4`) → `obs-visu-skins/main` (Fork `Micsi`).
2. **App-Basis nachziehen**: `integ/authz-upstream` als neue Sprint-Basis etablieren (bzw. in `feat/visu-mobile-skins` mergen), damit Contract 1.4 + Upstream-authz + Host auf der Fork-Arbeitslinie liegen.
3. **Links auf kanonische Auflösung** bringen (die lokalen `link:`-Umbiegungen sind Loop-Verkabelung, kein Commit-Ziel).
Alles ohne Upstream-Bezug; erst bei Visu-Release-Reife wird ein Upstream-Liefer­weg überhaupt Thema.

## 4. Infrastruktur-Notizen (für die Fortsetzung)
- **vite + cross-package `link:`**: vite verankert den Skin-Worktree-Pfad im Modul-Graph; Symlink-Umbiegen allein greift nicht — den `link:`-Pfad in `package.json` ändern + `pnpm install` + dev-server-Neustart mit `.vite`-Cache-Leerung. Marker-Test (`outline:magenta`) verifiziert, welche Kopie geladen wird.
- **Kritik/Screenshots**: Der In-App-Browser-Pane wurde instabil (Scroll-Timeouts, schwarze Frames bei der 2.7M-Vorlage). Robust: Playwright headless (`scratchpad/shoot.js`) — braucht ggf. `npx playwright install chromium`.
- **Live-Harness**: dev-server `preview_start {name:"visu-app"}` (Port 5175, launch.json). Vorlage-Referenz-Server: `python3 -m http.server 8231` im scratchpad.
