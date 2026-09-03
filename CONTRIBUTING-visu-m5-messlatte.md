# M5 Messlatten-Recherche - Runde 3 (Beleg-Matrix, korrigiert)

Quellen-Kürzel: **ED** = Edomi (nur R1-R17-Regeltabelle aus `CONTRIBUTING-visu-m5.md` §1 +
Issue `abeggled/openbridgeserver#1195`), **V2** = ioBroker vis-2, **HA** = Home Assistant
(Lovelace/Sections), **GF** = Grafana, **TW** = Timberwolf Server, **SV** = smartVISU,
**TU** = FHEM TabletUI.

Status: **B** = belegt, **N** = nicht vorhanden (aktiv geprüft, fehlt), **U** = nicht
erreichbar/unklar (mit Grund). Jede Zelle trägt eine Fußnoten-Kennung `[gN]`, aufgelöst in
Abschnitt "Fußnoten". Diese Runde bearbeitet ausschließlich die zwei von der Runde-2-Kritik
verlangten Punkte (g14c, E15-Champion); alle übrigen Zellen sind wörtlich aus
`m5-matrix-round2.md` übernommen, keine Neu-Recherche.

## Tabelle 1: E1-E15 x Referenzen

| # | Fähigkeit | ED | V2 | HA | GF | TW | SV | TU |
|---|---|---|---|---|---|---|---|---|
| E1 | Pixelgenaues Platzieren x/y/w/h, Snap-to-Grid, Rasterweite einstellbar | B(teilw.) [g1] | B(teilw.) [g2] | N [g3] | B [g4] | B(teilw.) [g5] | N [g6] | B [g7] |
| E2 | Responsives Authoring: Reihenfolge+Gruppierung ohne Koordinaten, persistent nach Reload (Testkriterium siehe unten) | N [g8] | N [g9] | B [g10] | N [g11] | N [g8] | B(teilw.) [g12] | N [g13] |
| E3 | Beide Paradigmen wählbar; Editor-Vorschau = Live-Renderer (Pixel-Diff-Testkriterium siehe unten) | - [g14] | - [g14] | - [g14] | - [g14] | - [g14] | - [g14] | - [g14] |
| E4 | Ausrichtlinie bei Kantendeckung (Toleranz), Verteilen bei ≥3 Elementen, gleiche Größe (Testkriterium siehe unten) | U [g15] | B [g16] | U [g15] | N [g17] | U [g15] | U [g15] | U [g15] |
| E5 | Mehrfachauswahl, Gruppenverschieben, Gruppieren | N [g5a] | B [g18] | U [g15] | U [g15] | U [g15] | U [g15] | U [g15] |
| E6 | Copy/Paste/Duplizieren (auch seitenübergreifend) | N [g6a] | B [g19] | U [g15] | B(teilw.) [g20] | U [g15] | U [g15] | U [g15] |
| E7 | Undo/Redo, Tastatur-Nudging | U [g15] | B(teilw.) [g21] | U [g15] | B(teilw.) [g22] | U [g15] | U [g15] | U [g15] |
| E8 | Z-Ordnung/Layer-Reihenfolge, Sperren/Ausblenden | N [g23] | B(teilw.) [g24] | N [g8c] | N [g8d] | N [g8e] | N [g8f] | N [g8g] |
| E9 | Seitentypen normal/Include/globalInclude/Popup (R1-R14) | B [g25] | B(teilw.) [g26] | U [g15] | U [g15] | N [g27] | N [g28] | B(teilw.) [g29] |
| E10 | Zentrale Vorlage propagiert automatisch in referenzierende Instanzen (Testkriterium siehe unten) | B [g30] | B [g31] | U [g15] | B [g32] | B(teilw.) [g33] | B [g34] | U [g15] |
| E11 | Datenpunkt-Bindung mit Suche/Filter und Live-Wert in Vorschau | U [g15] | B(teilw.) [g35] | B(teilw.) [g36] | B(teilw.) [g37] | B(teilw.) [g38] | U [g15] | U [g15] |
| E12 | Seitenversionen/Verlauf, Wiederherstellen | U [g15] | U [g15] | U [g15] | B [g39] | U [g15] | U [g15] | U [g15] |
| E13 | JSON-/Text-Ansicht der Seite neben der visuellen (Dualität) | U [g15] | U [g15] | B [g40] | B [g41] | U [g15] | N [g42] | N [g42] |
| E14 | Editor reagiert auf Touch-Events beim Verschieben/Resizen äquivalent zu Maus (Testkriterium siehe unten) | N [g14a] | B [g43n] | U [g43] | **U [g14c, korrigiert]** | N [g14d] | N [g44] | N [g44] |
| E15 | Zugriff/PIN/Zielgruppe direkt in Seiteneigenschaften | N(Regel fehlt) [g45] | U [g15] | **B(teilw.) [g47, neu]** | U [g15] | U [g46] | U [g15] | U [g15] |

Fett markierte Zellen sind die einzigen beiden Änderungen dieser Runde (E14/GF: N→U;
E15/HA: U→B(teilw.)). Alle anderen Zellen unverändert gegenüber Runde 2.

## Testkriterien (Playwright-Formulierungen)

Unverändert gegenüber Runde 2, nicht Gegenstand dieser Runde. Volltext siehe
`m5-matrix-round2.md` Abschnitt "Testkriterien".

## Fußnoten

### Unverändert gegenüber Runde 2 (Kurzform, Details siehe `m5-matrix-round2.md`)

Alle Fußnoten g1-g46 außer g14c sind wörtlich unverändert aus Runde 2 übernommen (inkl. deren
eigener Herkunftsvermerke "= alt f..." aus Runde 1). Vollständiger Wortlaut dort. Zur
Einordnung hier nur die für diese Runde relevanten Nachbar-Fußnoten:

- **g43** HA/E14: nur allgemeine Touch-Bedienung der fertigen Visu belegt, Editor selbst nicht
  eindeutig; `sortablejs` (patched) in `package.json`, aber Touch-Konfiguration im
  Sections-Editor nicht quellcode-verifiziert. Bleibt **U** (unverändert).
- **g43n** V2/E14: `react-dnd-touch-backend` aktiv per `isTouchDevice()`-Weiche in
  `Editor.tsx` Zeile 2597 verdrahtet. Bleibt **B** (unverändert) - weiterhin der einzige
  echte Quellcode-Champion der Zeile E14.
- **g46** TW/E15: Vorbehalt "Wird womöglich erst mit nachfolgender Version realisiert" direkt an
  "Nutzerberechtigungen*" angehängt (`elabnet.atlassian.net/.../1985740810`). Bleibt **U**
  (unverändert) - kein belastbarer Beleg für real existierende Rechteverwaltung.
- **g45** ED/E15: Zugriff/PIN pro Seite in R1-R17 nicht kodiert. Bleibt **N** (unverändert).

### Korrigiert in Runde 3

- **g14c** (E14, GF) **KORRIGIERT** (ersetzt "als offener Bug dokumentiert, N" aus Runde 2):
  Geprüft via `gh api repos/grafana/grafana/issues/62438` sowie dessen Timeline und Kommentare.
  Tatsächlicher Status: `state: closed`, `state_reason: completed`, `closed_at:
  2023-02-06T14:04:06Z` - **aber** die Schließung erfolgte nicht wegen eines Fixes, sondern als
  Duplikat: Maintainer-Kommentar (`natellium`, 2023-02-06) wörtlich: "seems this is the same as
  this issue that was reported a while ago https://github.com/grafana/grafana/issues/52010 ...
  I will close this issue as a duplicate". Das eigentliche Tracking-Issue #52010 ("Context menu
  not usable on mobile wide screen", 2022-07-09 bis 2023-03-07) wurde am selben Tag geschlossen
  wie das dort verlinkte Nachfolge-Issue `#63093` ("Panel header GA", geschlossen
  2023-04-21T07:50:06Z, `state_reason: completed`) referenziert wurde. Wörtliches Zitat aus dem
  Schluss-Kommentar zu #52010 (`natellium`, 2023-03-07): "this will be solved by the new panel
  Chrome implementation (see grafana/grafana#63093). It's currently in beta behind
  `newPanelChromeUI` and we're aiming to release it by default in 9.5." Eine unabhängige
  Bestätigung im Grafana-9.5-Changelog (`whatsnew-in-v9-5`) für "Panel Chrome"/"newPanelChromeUI"
  oder Touch/Mobile-Bezug wurde **nicht gefunden** (WebFetch der offiziellen What's-new-Seite:
  kein Treffer für diese Begriffe). Fazit: Die Behauptung "als offener Bug dokumentiert" war
  falsch (Issue ist seit 2023 geschlossen); die Gegenbehauptung "vollständig gefixt und
  bestätigt" wäre aber ebenso unbelegt - der Maintainer kündigte eine Lösung über einen
  Beta-Feature-Flag für 9.5 an, ohne dass das öffentliche Changelog dies wortwörtlich bestätigt.
  Zelle daher von **N** ("nachweislich kaputt") auf **U** ("Negativ-Befund veraltet/durch
  angekündigten, nicht unabhängig verifizierten Fix überholt") herabgestuft - weder ein
  belastbarer Positiv- noch Negativ-Beleg für den aktuellen Stand.

### Neu in Runde 3

- **g47** (E15, HA) **NEU**: `https://www.home-assistant.io/dashboards/views/` (WebFetch)
  bestätigt wörtlich: "You can specify the visibility of views as a whole or per-user." sowie
  das Feld "user string Required: User ID that can see the view tab (unique hex value found on
  the Users configuration page)." - ein View kann also direkt in seinen Eigenschaften auf
  bestimmte Benutzer beschränkt werden (Zielgruppe). Ergänzend
  `https://www.home-assistant.io/dashboards/dashboards/` (WebFetch) bestätigt für YAML-Modus-
  Dashboards wörtlich: "Should this dashboard be only accessible for admin users." (Feld
  `require_admin`, Default `false`) sowie für UI-erstellte Dashboards die Option, sie "visible
  only to the admin user" zu machen. Das deckt "Zielgruppe" (per-Benutzer-Sichtbarkeit von
  Views) und einen Teil von "Zugriff" (Admin-only) ab; ein PIN-Mechanismus wie bei OBS/TW ist in
  HA nicht dokumentiert und wird nicht behauptet. Daher **B(teilw.)** statt bisher U.
  Grafana-Dashboard-/Folder-Permissions (`grafana.com/.../manage-dashboard-permissions/`) wurden
  ebenfalls geprüft: die erwartete Doku-URL lieferte 404 (Grafana hat die Seite umstrukturiert);
  aus Zeitgründen nicht mit alternativer URL nachverfolgt - GF/E15 bleibt daher **U**
  (nicht "aktiv geprüft und nicht gefunden", sondern weiterhin ungeklärt).

  **Ergänzender Eigenbeleg (kein Spalten-Champion, nur Fußnote):** Das eigene OBS-V1 (dieser
  Worktree, `/Volumes/Daten/Projekte/openbridge/openbridgeserver-visu-integrate/`) implementiert
  dieselbe Fähigkeit bereits produktiv - `obs/models/visu.py` Zeile 62-63: `access: AccessLevel
  | None = None  # None = von Elternknoten erben` / `access_pin: str | None = None  # bcrypt-
  Hash, nie im Klartext`; `obs/api/v1/visu.py` implementiert vier Stufen (`readonly`,
  `public`/vererbt, `protected` mit bcrypt-gehashtem PIN Zeile 715-716/807-810, `user` mit
  Benutzer-Zuweisung Zeile 108-109/366). UI dazu liegt in
  `frontend/src/views/TreeManager.vue` (nicht in `VisuEditor.vue`, wie in der Aufgabenstellung
  vermutet): Zeile 282-286 definiert die vier Optionen (`readonly`/`public`/`protected`/`user`)
  mit Labels/Icons, Zeile 668-670 die PIN-Eingabe bei `protected`, Zeile 701 die
  Benutzerzuordnung bei `user`. Diese Fähigkeit ist die Owner-Anforderung R15/R16 aus dem Plan
  (`CONTRIBUTING-visu-m5.md` §1.1, Quelle dort selbst als "OBS-authz (eigen)" deklariert) und
  taucht bewusst **nicht** als eigene Spalte in Tabelle 1 auf, da sie keine Fremd-Referenz ist -
  sie dient hier nur als Beleg, dass die Fähigkeit real und nicht bloß eine Wunschliste ist.

## Ergänzungen E16+ (Super-Set-Kandidaten mit Beleg)

Unverändert gegenüber Runde 2 (nicht Gegenstand der Kritik) - E16 Bedingte Sichtbarkeit (HA),
E17 Konfigurierbare Responsive-Breakpoints (HA), E18 Import/Export (V2, GF), E19 Theming/Skin-
Auswahl (SV, TU), E20 Erweiterbares Plugin-/Widget-Set-System (V2), E21 Multi-Resolution-Views
(V2), E22 Formel-/Skript-Bindings (V2). Volltext siehe `m5-matrix-round1.md` Abschnitt
"Ergänzungen E16+".

## Streichkandidaten

Unverändert gegenüber Runde 2 - E3 bleibt keine Streichung (Owner-Synthese), E8 und E14 bleiben
keine Streichkandidaten (V2 liefert je einen Quellcode-Champion). E15 war in Runde 2 nicht als
Streichkandidat markiert, sondern als unbenannte Lücke kritisiert - siehe unten.

## Nicht erreichbar

Unverändert gegenüber Runde 2, siehe dort. Zusätzlich diese Runde: Grafana
Dashboard-/Folder-Permissions-Doku unter der erwarteten URL nicht erreichbar (404, Seite
vermutlich umstrukturiert) - GF/E15 bleibt ungeklärt.

## Super-Set-Empfehlung (härteste Latte je Zeile)

Unverändert gegenüber Runde 2 für E1-E13 (siehe `m5-matrix-round2.md`), außer:

- **E14**: vis-2 bleibt die Latte (`react-dnd-touch-backend` per `isTouchDevice()`-Weiche,
  Quellcode-belegt). **Geändert:** Grafana wird nicht mehr als "dokumentierte Negativ-Latte"
  geführt - Issue #62438 ist seit 2023 geschlossen (als Duplikat), der referenzierte Fix
  (`newPanelChromeUI`, Ziel-Release 9.5) ist maintainer-angekündigt, aber nicht unabhängig im
  Changelog verifiziert. Die Zeile hat damit nur noch einen einzigen belastbaren Beleg (vis-2),
  keinen Gegenbeleg mehr.
- **E15**: **erstmals ein Champion in der Matrix selbst.** Home Assistant setzt die Latte -
  per-View-Sichtbarkeit nach Benutzer-ID (`visible: user: <id>`) plus `require_admin` für
  YAML-Dashboards bzw. "visible only to admin" für UI-Dashboards. Kein PIN-Mechanismus bei HA;
  OBS' eigenes vierstufiges Modell (`readonly`/`public`/`protected`+PIN/`user`) bleibt strenger
  und ist Owner-Referenz (R15/R16), zählt aber nicht als Fremd-Champion. TW bleibt U (Feature
  laut Quelle selbst als "künftig" markiert, nicht als existierend belegt).

## Fazit (per Skript nachgezählt)

Skript: `/private/tmp/claude-501/-Volumes-Daten-Projekte-openbridge/09b20e07-128b-453e-a737-19c5f10ad2fd/scratchpad/count_matrix_r3.py`
(Zellen-Status Zeile für Zeile aus Tabelle 1 übertragen, `B`/`B(teilw.)` zusammen als `B`
gezählt, exakt wie in Runde 1/2s Zählweise).

Über Tabelle 1 (E1-E15 x 7 Referenzen, **105 Zellen**):

- **B (belegt/teilw. belegt): 31**
- **N (aktiv geprüft, nicht vorhanden): 25**
- **U (nicht erreichbar/nicht geprüft/nicht mehr eindeutig): 42**
- **„-" (E3, Owner-Synthese, keine Referenz-Eigenschaft): 7**
- Kontrollsumme 31+25+42+7 = 105 ✓

Gegenüber Runde 2 (B=30, N=26, U=42, „-"=7): **B 30→31** (+1: HA/E15 neu B(teilw.)), **N
26→25** (-1: GF/E14 von N auf U herabgestuft, da Negativ-Beleg veraltet), **U bleibt 42**
(netto 0: +1 durch GF/E14, -1 durch HA/E15), „-" unverändert 7.

## Änderungen gegenüber Runde 2

1. **g14c (E14/Grafana) korrigiert:** Die Behauptung "als offener Bug dokumentiert" war falsch.
   `gh api repos/grafana/grafana/issues/62438` zeigt `state: closed`, `state_reason: completed`,
   geschlossen 2023-02-06 - allerdings **als Duplikat** von `#52010`, nicht weil das Problem
   selbst als gelöst verifiziert wurde. Die Spur führt weiter zu `#52010` (geschlossen
   2023-03-07 mit Maintainer-Zitat: Fix über `newPanelChromeUI`-Feature-Flag, Ziel-Release 9.5,
   siehe verlinktes `#63093` "Panel header GA", geschlossen 2023-04-21) - ein angekündigter,
   aber nicht im offiziellen 9.5-Changelog unabhängig bestätigter Fix. Zelle E14/GF daher von
   **N** ("nachweislich kaputt") auf **U** ("veralteter Negativ-Befund, kein belastbarer
   aktueller Beleg in beide Richtungen") korrigiert. Die Super-Set-Empfehlung für E14 wurde
   entsprechend angepasst (Grafana nicht mehr als Negativ-Latte geführt, vis-2 bleibt einziger
   Champion).
2. **E15-Champion gefunden:** Home Assistant liefert einen echten, extern dokumentierten Beleg
   - `https://www.home-assistant.io/dashboards/views/` ("visibility of views ... per-user",
   Feld `user`) und `https://www.home-assistant.io/dashboards/dashboards/` (`require_admin` /
   "visible only to the admin user"). Zelle HA/E15 von **U** auf **B(teilw.)** angehoben
   (Fußnote g47). Ergänzend als Fußnote (nicht als Spalte) dokumentiert: OBS V1 selbst
   implementiert dieselbe Fähigkeit bereits produktiv vierstufig (`obs/models/visu.py` Zeile
   62-63, `obs/api/v1/visu.py` Zeile 715-716/807-810, UI in
   `frontend/src/views/TreeManager.vue` Zeile 282-286/668-670/701 - **nicht** in
   `VisuEditor.vue`, wie ursprünglich vermutet, dort nur ein einzelner `cur.access`-Treffer ohne
   UI-Kontext). Grafana-Dashboard-Permissions-Doku unter der erwarteten URL lieferte 404, GF/E15
   bleibt daher U (nicht aktiv widerlegt, nur nicht erreicht). Damit hat E15 jetzt einen
   benannten Fremd-Referenz-Champion (HA) und ist nicht mehr die einzige Zeile ohne Champion -
   der von der Kritik benannte Kernmangel ist behoben.
3. **Super-Set-Empfehlung** für E14 und E15 aktualisiert (nicht "unverändert" belassen, siehe
   oben) - beide Änderungen sind explizit im Abschnitt "Super-Set-Empfehlung" nachvollzogen.
4. **Zahlen neu gezählt** (Skript `count_matrix_r3.py`, Kontrollsumme 105): B=30→31, N=26→25,
   U=42→42 (netto 0, siehe Aufschlüsselung oben), „-"=7 unverändert.
5. Alle übrigen 103 Zellen, alle Fußnoten g1-g13/g15-g46 (außer g14c) und die
   Testkriterien-Formulierungen sind wörtlich unverändert aus Runde 2 übernommen - keine
   Neu-Recherche außerhalb der zwei Kritikpunkte, wie beauftragt.
