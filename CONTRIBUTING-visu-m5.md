# Contributing - M5: Authoring + Seitentypen (Visu 2.0, quality-loop-Welle)

> Plan-/Vertrags-Dok für die Welle **M5**. Nachfolger von `CONTRIBUTING-visu-layering.md`
> (dort §3 „M5 (später, separat)"). Aufgebaut als **quality-loop-Lauf**: Ziel, Messlatte,
> Zerlegung in einzeln beurteilbare Teile, Bremsen, Gates, Fortschrittsseite. Erst lesen,
> dann bauen. Kein Teil startet vor der Freigabe der Zerlegung (§3) durch den Owner.

## 0. Ziel (ein Satz)

Layering-Seiten sollen **anlegbar** werden: Popups, Inkludeseiten und globale Inkludeseiten
werden erstklassige Seitentypen im Backend, der Host komponiert daraus (statt aus der
`parent_id`-Näherung), und ein neuer V2-Editor lässt sie WYSIWYG gegen den echten Skin bauen.

Heute steht das Rendering (W1-W4, Edomi-POC), aber niemand kann eine Layering-Seite erzeugen.
M5 schließt genau diese Lücke.

## 1. Messlatte (klar, selbst nachprüfbar, so hoch wie möglich)

**Referenz = Edomis eigenes Seitentyp-Modell**, wörtlich aus der Edomi-Visu-Seitenhilfe
(vom Owner geliefert). Sie wird als **Regeltabelle** in Tests kodiert und ist damit
maschinell nachprüfbar - keine Adjektive:

| # | Regel (Edomi) | Nachweis |
|---|---|---|
| R1 | Seitentyp: normal / Inkludeseite / globale Inkludeseite / Popup | Backend-Enum + Editor-Auswahl + Nav-Badge |
| R2 | Popup: X/Y-Position in px; fehlt eine Angabe → zentriert | Host-Popup + Edomi-Render |
| R3 | Popup: Breite/Höhe in px | dito |
| R4 | Popup: automatisch schließen nach Zeitspanne | Host-Timer (existiert) |
| R5 | Popup: exklusiv öffnen = modal, Rest inert | Host `inert` (existiert) |
| R6 | Popup: Animation, Schlagschatten, Hintergrund abdunkeln | Deskriptor-Flags → Skin |
| R7 | Auto-Close-Zeit wird beim erneuten Öffnen **nicht** verlängert | Host (existiert, Test vorhanden) |
| R8 | Beliebig viele **verschiedene** Popups gleichzeitig | Host-`openPopups[]` |
| R9 | Globale Inkludeseite wird in **jede normale** Seite inkludiert, **nicht** in Popups | Komposition |
| R10 | Mehrere globale Includes: aufsteigend gestapelt, kleinste zuerst | Komposition (Ordnung = Knoten-`order`, s. §2.2) |
| R11 | Direktaufruf einer globalen Inkludeseite zeigt die **anderen** globalen nicht | Komposition |
| R12 | Globale Inkludeseiten können **keine** weiteren Seiten inkludieren (eine Ebene) | Backend-Validierung 400 |
| R13 | Normale Seite kann globale Includes **ignorieren** | Flag + Komposition |
| R14 | Individuelle Inkludeseite: gewählte Seite wird eingebettet | Komposition |
| R15 | Include quer über eine Zugriffsgrenze: nicht lesbare Quelle wird **verdeckt**, readonly-Quelle → Widgets gesperrt | authz-E2E (Generalisierung von `widget-ref`) |
| R16 | Editor-Round-Trip: im Editor angelegt → gespeichert → Edomi rendert per R1-R15 | Playwright gegen echtes Backend |
| R17 | V1 (`frontend/`) bleibt unberührt und grün | V1-Vitest + Smoke |

**Messlatte für den Editor (Teil C) - Owner-Vorgabe: nicht V1, sondern der beste am Markt
befindliche vergleichbare Editor, bzw. das Super-Set der besten Eigenschaften mehrerer.**
Diese Latte ist eine **Feature-Matrix** (§1.1), die Teil **M** aus den *erreichbaren*
Referenzen belegt zusammenstellt - jede Zeile mit Quelle, und jede Zeile später als
Playwright-Kriterium in unserem Editor nachprüfbar. Adjektive („modern", „komfortabel")
sind keine Zeilen. Eine Referenz, an die wir nicht herankommen, liefert keine Zeile
(Skill-Regel: „kommst du nicht heran, erfindest du den Vergleich").

### 1.1 Referenz-Editoren und Messlatten-Matrix (verbindlich, von Teil M belegt)

| Referenz | Zugang (prüfbar) | Wofür sie die Latte setzt |
|---|---|---|
| **Edomi** | Hilfetexte des Owners (Seitentypen, Popups, Includes); Screenshots aus #1195 | Pixelgenauigkeit, Layering-Modell, Popups |
| **ioBroker vis-2** | Open Source (GitHub `ioBroker/ioBroker.vis-2`), Demo/Docs | Pixel-Editor-Ergonomie: Snap, Ausrichten, Mehrfachauswahl, Gruppen, Views, Undo |
| **Home Assistant (Lovelace/Sections)** | Open Source, öffentliche Demo | Responsives Karten-/Sektionen-Authoring, Drag-Reihenfolge, Visual+YAML-Dualität |
| **Grafana** | Open Source, `play.grafana.org` | Raster-Editor-UX, Panel-Bibliothek, Variablen, Versionen/Verlauf, JSON-Modell |
| **Timberwolf Server** | öffentliche Doku/Wiki (Produkt, das OBS ersetzt) | Erwartungshorizont der OBS-Zielnutzer |
| **smartVISU / FHEM TabletUI** | Open Source | Deklaratives/Template-Authoring als Gegenpol |

**Verbindliche Messlatte (Teil M, 3 Runden, Kritiker-Urteil „tauglich" am 2026-09-03).** Belege je Zelle
(URL/Datei-Pfad + Zitat/Symbol, 105 Zellen: 31 belegt, 25 aktiv „nicht vorhanden", 42 ungeprüft, 7 gegenstandslos)
in `CONTRIBUTING-visu-m5-messlatte.md`. Jede Zeile hat einen belegten Champion oder ist als Owner-Synthese
markiert (E3). E20-E22 sind belegte Fähigkeiten, aber außerhalb des M5-Scopes (Folge-Wellen, siehe §3).

| # | Prüfbare Fähigkeit (Playwright-Kriterium) | Härtester Champion (belegt) | Teil |
|---|---|---|---|
| E1 | Element per Drag auf Pixel-Koordinate x/y setzen, Snap rastet bei einstellbarer Rasterweite ein | Grafana (auch ED/TW/TU teilw.) | C2 |
| E2 | Reihenfolge/Gruppe eines Elements per Drag setzbar (kein x/y-Feld), Order-Array vor/nach Reload identisch | Home Assistant | C2 |
| E3 | Editor-Vorschau = Live-Renderer, Pixel-Diff Editor- vs. Live-Screenshot = 0 abweichende Pixel außerhalb Editor-Chrome | Owner-Synthese, kein Fremd-Champion | C4 |
| E4 | Ausrichtlinie bei Kantendeckung ≤4px, "Verteilen" bei ≥3 Elementen, "gleiche Größe" übernimmt Maße | ioBroker vis-2 | C2 |
| E5 | Mehrfachauswahl per Rahmen, Gruppenverschieben, Gruppieren-Aktion | ioBroker vis-2 | C5 |
| E6 | Copy/Paste/Duplizieren eines Elements, auch seitenübergreifend | ioBroker vis-2 | C5 |
| E7 | Undo/Redo-Stack, Pfeiltasten nudgen selektiertes Element pixelweise | ioBroker vis-2 (teilw.) | C5 |
| E8 | Z-Ordnung änderbar (nach vorne/hinten), Element sperr-/ausblendbar | ioBroker vis-2 (teilw.) | C2 |
| E9 | Seitentypen normal/Include/globalInclude/Popup wählbar und wirksam | Edomi | C1+A+B |
| E10 | Änderung an zentraler Vorlage propagiert automatisch in referenzierende Instanzen ohne manuellen Re-Import | Edomi/vis-2/Grafana/Timberwolf/smartVISU | A+B+C3 (Include) |
| E11 | Datenpunkt-Bindung mit Suche/Filter, Live-Wert erscheint in Editor-Vorschau | ioBroker vis-2 / Home Assistant / Grafana / Timberwolf | C3 |
| E12 | Seitenversionen einsehbar, frühere Version wiederherstellbar | Grafana | C6+A |
| E13 | Seite als JSON/Text UND visuell editierbar, beide Ansichten synchron | Home Assistant / Grafana | C6 |
| E14 | Touch-Drag/-Resize eines Widgets im Editor bewegt es um dieselbe Distanz wie Maus-Drag (`page.touchscreen`) | ioBroker vis-2 | C5 |
| E15 | Zugriff/Zielgruppe direkt in Seiteneigenschaften setzbar (mind. Admin-only/Nutzer-Sichtbarkeit) | Home Assistant (OBS-eigenes 4-Stufen-Modell als Owner-Latte darüber) | C1 |
| E16 | Element bedingt sichtbar/unsichtbar je nach Datenpunktwert | Home Assistant | C3 |
| E17 | Responsive-Breakpoints in Seiteneigenschaften konfigurierbar | Home Assistant | C2 (responsiver Modus) |
| E18 | Seite/Vorlage als Datei export-/importierbar | ioBroker vis-2 / Grafana | C6 |
| E19 | Skin/Theme pro Seite oder global wählbar | smartVISU / FHEM TabletUI | C1 |
| E20 | Externes Widget-/Plugin-Set registrierbar, erscheint in Editor-Palette ohne Neubau (Playwright-Kriterium fehlt noch, nachzuliefern) | ioBroker vis-2 | nicht M5 (Widget-Typen jenseits der 9 Kern-Typen) |
| E21 | Eine Seite in mehreren Auflösungs-/Geräte-Varianten pflegbar | ioBroker vis-2 | nicht M5 (responsiver Modus deckt Geräteklassen; Varianten = Folge-Welle) |
| E22 | Formel-/Skript-Binding statt reiner 1:1-Datenpunktbindung | ioBroker vis-2 | nicht M5 (Logik/Formeln = Backend-Track) |

**Design-Invariante (aus der Owner-Vorgabe):** Pixel-Autorenschaft ist ein *Angebot*, kein
Zwang. Eine Seite trägt entweder Koordinaten (Pixel-Modus) oder nur Reihenfolge/Gruppe
(responsiver Modus); der Skin entscheidet, was er honoriert (Contract: `position` additiv).
Der Editor zeigt je Skin, welcher Modus gerendert wird.

**Verifikationsträger:** die bestehende Playwright-Harness `apps/visu/e2e/` (Seed +
Specs gegen echten authz-Server). M5 erweitert Seed + Specs; **ohne grünen Round-Trip (R16)
gegen echten Server gilt M5 nicht als fertig** - dieselbe Härte wie Welle 4 des authz-Tracks.

## 2. Vorab-Entscheide (A0) - fixieren die Schnittstellen, damit alles parallel laufen kann

Diese Entscheide sind **kein Loop-Teil**; sie stehen vor dem Lauf fest, damit A/B/C/E
gleichzeitig gegen dieselbe Form bauen (B/C/E stubben das Backend, bis A landet).

### 2.1 Backend-Form (Python, additiv, V1-kompatibel)

```python
# obs/models/visu.py
PageKind = Literal["normal", "popup", "globalInclude"]

class PopupConfig(BaseModel):            # nur für kind == "popup"
    x: int | None = None; y: int | None = None   # eine fehlt → zentriert (R2)
    w: int | None = None; h: int | None = None
    auto_close_ms: int | None = None              # R4
    modal: bool = False                           # „exklusiv öffnen" (R5)
    animate: bool = False; shadow: bool = False; dim_backdrop: bool = False  # R6

class PageConfig(BaseModel):            # JSON-Spalte → KEINE Migration nötig
    ...bestehend...
    includes: list[str] = []            # individuelle Include-Seiten, geordnet (R14)
    ignore_global_includes: bool = False  # R13
    popup: PopupConfig | None = None

class VisuNode(BaseModel):
    ...bestehend...
    kind: PageKind = "normal"           # NEUE SPALTE (Nav/Summary brauchen es ohne page_config)
```

- `kind` als Spalte. **Nicht** im `visu_nodes_vNN`-Copy-Muster: das `DROP TABLE` des Kopiermusters
  loescht per `ON DELETE CASCADE` die authz-Seiten-Policies und PIN-Credentials (durch SQLite-Probe
  belegt, Regressionstest vorhanden). Stattdessen `ALTER TABLE ADD COLUMN` mit `CHECK`, Default `normal` →
  alle Bestandsseiten bleiben normal, V1 ignoriert unbekannte Felder - R17 per Test belegen).
- `VisuNodeSummary`, `VisuNodeCreate`, `VisuNodeUpdate` tragen `kind`.
- **Validierung (400):** globalInclude darf nicht inkludieren (R12); popup hat keine globalen
  Includes (R9, Komposition) und keine `includes`; keine Selbst-Includes; keine Include-Zyklen;
  `includes` dürfen nur auf `kind == normal`-Seiten zeigen? - **Nein**: Ziel darf normal oder
  globalInclude sein (Edomi erlaubt das Einbetten einer Inkludeseite); nur Popups nicht.
- **Kein neuer Auflösungs-Endpoint.** Der Host lädt jede PAGE-Config schon heute einzeln und
  page-scoped (`loadPageConfigs` → `GET /pages/{id}`). Include-Quellen sind gewöhnliche Seiten
  und kommen über denselben Weg.
- **Verdeckungs-Vertrag (R15), korrigiert gegen das reale Backend-Verhalten.** Die ursprüngliche
  Zusage „nicht lesbar → 404" stimmt nur für die Navigations-Endpunkte. Das Zwei-Ebenen-Modell der
  authz-Welle (Upstream #583, durch Bestandstests in `tests/unit/test_visu_authz.py` festgeschrieben,
  z. B. `test_export_hides_user_page_from_api_key_with_visu_grant`) ist bewusst so gebaut und wird
  von M5 **nicht** geändert:

  | Ebene | Endpunkt | nicht lesbar |
  |---|---|---|
  | Navigation/Existenz | `GET /visu/tree`, `/nodes/{id}`, `/nodes/{id}/children`, `/nodes/{id}/breadcrumb` | Knoten fehlt im Baum bzw. **404** – die Existenz wird verdeckt |
  | Seiteninhalt | `GET /visu/pages/{id}`, `GET /visu/widget-ref/{id}` | **401** (`Anmeldung erforderlich` / `PIN-Authentifizierung erforderlich`) bzw. **403** (`Zugriff verweigert`) |

  Für den Host heißt das: Verdeckung entsteht **auf der Navigationsebene**. Eine Include-Quelle, die
  der Principal nicht sehen darf, taucht schon im Baum nicht auf. Wird sie trotzdem geladen (weil sie
  in einer `includes`-Liste steht), gilt für `GET /visu/pages/{id}` diese **vollständige** Signalliste;
  Teil B baut gegen sie, nicht gegen 404 allein:

  | Signal (Status + `detail`) | Lage | Teil B |
  |---|---|---|
  | **404** | die Seite existiert nicht (mehr) oder ist auf Navigationsebene verdeckt | still weglassen |
  | **403** `Zugriff verweigert` | verdeckt: die Seite (oder ein Elternknoten) ist `user`-geschützt und der Principal gehört nicht zur Zielgruppe bzw. hat kein Leserecht auf ihre Datenpunkte | still weglassen, kein Fehlerpfad, keine Meldung |
  | **401** `Anmeldung erforderlich` | verdeckt, solange kein Login vorliegt | still weglassen; nach einem Login neu laden |
  | **401** `PIN-Authentifizierung erforderlich` | **keine Verdeckung**, sondern eine auflösbare Aufforderung: `POST /visu/nodes/{id}/auth` liefert ein Session-Token, das als `X-Session-Token` dieselbe Seite lesbar macht | nicht kommentarlos verwerfen: entweder die PIN an der Include-Stelle abfragen oder die Include-Stelle sichtbar als „gesperrt" markieren. Ein stilles Weglassen wäre hier ein Bedienfehler, keine Verdeckung |
  | **400** `Knoten ist keine Seite` | das Ziel ist ein Ordner (`LOCATION`) statt einer Seite. Über die API nicht mehr herstellbar (Include-Ziele werden beim Speichern geprüft, und der Import lehnt `includes` an Nicht-Seiten ab), aber aus Restore/Migration/DB-Zugriff weiterhin möglich | wie „existiert nicht" behandeln: still weglassen |

  **Welche Include-Ziele wann geprüft werden** (bewusste Asymmetrie, damit C1 die Include-Auswahl
  passend baut): ein **neu** hinzugefügtes direktes Ziel wird streng geprüft (existiert, ist eine
  Seite, ist kein Popup – sonst 400); ein **unverändert** mitgeschickter, bereits gespeicherter
  Eintrag wird nicht erneut gegen die Datenbank geprüft, damit eine Seite nie dauerhaft
  unspeicherbar wird; **verschachtelte** Ziele (das Ziel des Ziels) werden gar nicht geprüft, die
  Zyklusprüfung folgt der Kette und überspringt fehlende Glieder. Teil B muss deshalb damit rechnen,
  dass eine `includes`-Liste Einträge enthält, die beim Laden eines der obigen Signale liefern.

  **`includes` ist dublettenfrei.** Das Modell entfernt Duplikate still (erstes Vorkommen gewinnt,
  Reihenfolge bleibt); Teil B komponiert jede Seite also höchstens einmal und braucht kein eigenes
  Entdoppeln.

  **Grenze der Verdeckung, offen für Teil B/C1:** `GET /visu/pages/{id}` liefert `includes` roh. Eine
  lesbare Seite gibt damit die IDs ihrer Include-Quellen preis, auch wenn diese auf der
  Navigationsebene verdeckt sind – zusammen mit dem Unterschied 401/403 (existiert) vs. 404
  (existiert nicht) ein Existenz-Orakel. Derselbe Weg existiert seit V1 über
  `widget.config.source_page_id`; M5 erweitert ihn, erfindet ihn nicht. Verdeckung gilt also für
  Existenz **in der Navigation**, nicht für die ID in einer fremden Seiten-Konfiguration.
- **`source_page_readonly`** wird aus dem aufgelösten Zugriffs-Level der Quellseite abgeleitet
  (dieselbe Regel wie `GET /widget-ref/{page_id}`: `access == "readonly"`).
  **Naht:** `GET /visu/pages/{id}` liefert das Ergebnis als Antwort-Header
  `X-Source-Page-Readonly: true|false`. Der Body (`PageConfig`) trägt kein Zugriffs-Level, und der
  Baum reicht nicht: `access` steht dort roh (`null` = vom Elternknoten erben) und `parent_id` wird
  auf `null` gekappt, sobald der Elternknoten verdeckt ist – die Vererbungskette ist clientseitig
  also nicht zuverlässig auflösbar. Der Header ist damit die einzige verlässliche Quelle; B/E lesen
  ihn beim Laden einer Include-Quelle und setzen daraus `writable=false`.

- **Nur der Statuscode ist Vertrag, nie der Meldungstext.** `spa_404_handler` in `obs/main.py`
  ersetzt das `detail` **jedes** 404 unterhalb von `/api/` durch `"Not found"`. Wer auf einen
  bestimmten Fehlertext prüft, baut auf Sand: Client-Logik und Tests hängen am Status.

- **Grenzen der obigen Zusagen (vom Kritiker belegt, Teil B muss damit rechnen):**
  - Die Ausnahme fuer gespeicherte `includes` gilt fuer die Ziel-Pruefungen, **nicht** fuer Zyklus und
    Selbst-Include: die werden ueber die ganze Liste geprueft. Ein roh in die DB gesetzter Zyklus laesst
    daher auch einen unveraenderten Round-Trip mit 400 scheitern (Micsi/openbridgeserver#177).
  - Die Dublettenfreiheit wirkt im Modell, also **auch beim Lesen**: die Antwort kann still von der
    gespeicherten Zeile abweichen, und ein unveraenderter Round-Trip schreibt die Bereinigung fest.
  - `GET /visu/nodes/{id}/export` und das Config-Backup lesen **roh** an der Modellschicht vorbei und
    sind daher nicht dublettenfrei. Wer Export-Daten weiterverarbeitet, dedupliziert selbst.
  - `POST /visu/nodes/{id}/copy` validiert `includes` derzeit nicht (Micsi/openbridgeserver#178).

### 2.2 Bewusste Abweichung von Edomi

Edomi stapelt globale Includes „aufsteigend nach ID". Wir stapeln nach Knoten-**`order`**
(deterministisch, vom Autor steuerbar, existiert bereits). Das ist besser und im Editor
sichtbar; R10 wird so kodiert.

### 2.3 Contract 1.14 (additiv, minor) - 1.12 (Link-Naht, #151) und 1.13 (a11y, #153) sind in offenen PRs der Parallel-Session vergeben

Seit 1.12 ist `honors` eine **geprüfte Liste** im Schema (`order·grouping·role·position·nav·layers·popup·link`);
der Konformitätslauf lehnt unbekannte Token als `unknown` ab. M5 führt **kein** neues Token ein
(Seitentypen sind Host-Komposition, der Skin sieht weiterhin `layers`/`popup`); sollte A0 doch eines
brauchen, gehört es in dieselbe Liste + Skins-first-Kaskade.

Einziges neues Feld: `NavNode.kind?: PageKind`, damit ein Skin globale Includes und Popups
aus seiner Navigation ausblenden kann. `PageLayer.origin` (`global|include|own`) und
`PopupDescriptor` existieren seit 1.9/1.10 bereits. Bump 1.13 → 1.14 löst die bekannte
skins-first-Kaskade aus (ionic/terminal/edomi `targetsContract` + Test-Literale) - siehe
Memory `visu-crossrepo-ci-pinning`; landet als Fork-PR mit Owner-Merge-Tap.

### 2.4 Wo lebt der V2-Editor - OWNER-ENTSCHEID: in der Admin-GUI (`gui/`), keine eigene App

Trennlinie: **Visu-Endpunkt** (`apps/visu`, mobil, nutzer-facing, ggf. ohne Login) ↔ **Authoring in
der Admin** (`gui/`, JWT + Berechtigungen werden hier ausgewertet). Analog V1, dessen Editor ebenfalls
JWT-gesperrt neben der Visu liegt (`frontend/` `/editor/:id`; bleibt unangetastet, R17).

- Neuer Admin-Bereich „Visu-Editor" in `gui/` (Vue 3 + Pinia + vue-i18n + Vitest, npm-Gates aus AGENTS.md).
- **WYSIWYG (E3) über eine eingebettete Vorschau der echten mobilen Visu**: `gui/` bettet `apps/visu`
  in einem Preview-Modus als iframe ein; der Editor schickt den *Entwurf* (Seite + Widgets + Positionen)
  per `postMessage` in die Vorschau, die ihn über denselben SkinHost mit dem gewählten Skin rendert.
  Kein zweiter Renderer, keine Daten-Kopie: die Vorschau ist die Visu.
- Live-Werte in der Vorschau: die Vorschau erhält die Admin-Session per `postMessage` (nie URL/Query),
  Datenpunkt-Ops laufen wie in der Visu page-scoped (X-Page-Id) gegen das Backend.
- Gast-Bundle von `apps/visu` wächst nur um den Preview-Empfänger (code-split, gemessen); der Editor
  selbst liegt komplett in `gui/`.
- **Vorschau-Datenquelle (Falle, Sprint-Erfahrung der Parallel-Session):** `MockDataSource` kann kein
  Layering (`navTree()`/`layersFor()` fehlen) → seitenbesitzende Skins rendern **stumm leer**. Die
  Vorschau braucht eine eigene `PreviewDataSource`, die den Entwurf als `navTree()`/`layersFor()`/
  `positions()` liefert und Datenpunkt-Werte vom Backend bezieht. Der Entwurf fließt **über den Host**
  (Store/PageHost) in den Skin, nie direkt hinein (Goldene Regel: Skin besitzt keinen Zustand).
- Links in der Vorschau: `PageHost.resolveLink` (seit 1.12) zeigt die Affordanz, ohne zu navigieren.

### 2.5 Branch-Basis und Worktree

- `integ/visu-m5` wurde am 2026-09-03 auf `00077b3a` (Fork-HEAD `feat/visu-mobile-skins`, enthält #151 /
  Contract 1.12) angelegt (Owner: nicht auf #153 warten). #152 und #153 (Contract 1.13) werden nach ihrem
  Merge per `git merge fork/feat/visu-mobile-skins` nachgezogen, ohne Umschreiben. Bis dahin: kein Commit
  auf `feat/visu-mobile-skins`, kein `packages/contract`-Bump (1.14 erst nach 1.13).
- **Eigener Worktree** `openbridgeserver-visu-m5` für alle M5-Arbeit. `openbridgeserver-visu-integrate`
  ist das Dev-Link-Ziel (`link:`) aller drei Skins der Parallel-Session: dort **nie** Branch wechseln,
  `pnpm install` oder Contract bauen (verschiebt still den Vertrag unter laufenden Messungen). Doku
  schreiben ist dort unkritisch.
- Skins-Seite (`obs-visu-skins`): Fixture-Wand mit allen drei Skins + renderer-ausführender
  Konformitätslauf existieren; `edomi/src/page.ts` ist der einzige seitenbesitzende Skin und damit der
  realistischste Testfall für Seitentypen (Teil B/E).

## 3. Zerlegung - die parallelen Teile (je ein Bau-Agent + ein getrennter Kritiker)

| Teil | Inhalt | Repo/Ort | Messlatte (Kritiker prüft am Artefakt) | hängt ab von |
|---|---|---|---|---|
| **M Messlatten-Recherche** (Micsi/openbridgeserver#165) (läuft zuerst, parallel zu A) | Feature-Matrix §1.1 an den erreichbaren Referenzen **belegen**: pro Zeile Quelle (Repo-Pfad, Demo-Screenshot, Doku-Link), Streichungen/Ergänzungen begründet; Ergebnis = verbindliche Latte für C1-C6 | `CONTRIBUTING-visu-m5.md` §1.1 (aktualisiert) + `docs/` Belege | Kritiker prüft **jede Zeile gegen die Quelle** (Screenshot/Code), nicht gegen die Behauptung; keine unbelegte Zeile bleibt | - |
| **A Backend-Modell** (Micsi/openbridgeserver#166) (Pilot, läuft zuerst allein durch) | `kind`-Spalte + Migration, `PopupConfig`, `includes`/`ignore_global_includes`, Validierung R9/R12/Zyklen/Selbst, `kind` in Create/Update/Summary/Tree, Export/Import/Copy tragen die Felder mit | `obs/` | pytest: Regeltabelle als Testfälle (jede Regel beide Seiten), Migration auf Bestands-DB, V1-Frontend-Vitest grün (R17), Coverage-Patch Line+Branch | A0 |
| **B Host-Komposition** (Micsi/openbridgeserver#167) | `compose.ts`: Näherung ablösen → globale Includes (nach `order`, außer `ignore`, nie in Popups), individuelle Includes (eine Ebene), eigen; Popups aus `kind=popup` → `PopupDescriptor`; `NavNode.kind`; readonly-Quelle → `writable=false` | `apps/visu`, `packages/contract` (1.14) | `compose.spec` = Regeltabelle R9-R15; Edomi-E2E rendert Seed per Regeln | A0 (Form), Contract 1.14 |
| **C1 Editor: Baum + Seiteneigenschaften** (Micsi/openbridgeserver#168) | Knoten-CRUD (bestehende API), `kind`-Wahl, Zugriff/PIN, `order`, Popup-Eigenschaften-Formular (R2-R6), Include-Picker (nur erlaubte Ziele), Global-Ignorieren-Schalter, Validierungsfehler inline | `gui/` Visu-Editor | Playwright: jede Eigenschaft setzen → `GET` zeigt sie; verbotene Kombinationen werden **vor** dem Speichern abgefangen (E9, E15) | A0, C4, M |
| **C2 Editor: WYSIWYG-Canvas** (Micsi/openbridgeserver#169) | Vorschau über den echten `SkinHost` (Skin wählbar), Drag/Resize schreibt `x/y/w/h` ins Raster (`grid_cell_width`), Rastereinstellungen, Layer-Sichtbarkeit (globale/Include-Layer ein-/ausblendbar) | `gui/` Visu-Editor | Visual-Gate + Playwright: Pixel-Modus (E1, E4, E8) und responsiver Modus (E2) je Seite wählbar, Vorschau im echten Skin (E3); gesetzte Box == Anzeige in Edomi | A0, C4, B, M |
| **C3 Editor: Widget-Palette + Bindung** (Micsi/openbridgeserver#170) | Die 9 Contract-Typen anlegen, Datenpunkt-Picker (`/datapoints`), Typ-Config (Licht: dp_switch/dp_dim/mode; Rolladen: dp_position/invert/lock; …) - Formen aus dem Mapper (`mapping.ts`) abgeleitet, nicht aus V1 kopiert | `gui/` Visu-Editor | Playwright: angelegtes Widget rendert in Vorschau mit Live-Wert; Suche/Filter (E11); Bibliothek/Vorlagen (E10) | A0, C4, M |
| **C4 Editor: Vorschau-Brücke + Admin-Einbettung** (Micsi/openbridgeserver#171) | Preview-Modus in `apps/visu` (Empfänger für Entwurf + Session per `postMessage`, Origin-Prüfung, code-split), iframe-Einbettung + Menüpunkt in `gui/` hinter Admin-Login; Nicht-Admin sieht den Bereich nicht | `apps/visu` (Preview), `gui/` | Playwright: Entwurf → Vorschau rendert ihn im gewählten Skin ohne Speichern; Token nie in URL/Query/Logs; Gast-Bundle nur um den Empfänger gewachsen (gemessen); Nicht-Admin → kein Editor | A0, B |
| **C5 Editor: Ergonomie** (Micsi/openbridgeserver#172) | Mehrfachauswahl + Gruppenverschieben (E5), Copy/Paste/Duplizieren auch seitenübergreifend (E6), Undo/Redo + Tastatur-Nudging (E7), Touch-Bedienung (E14) | `gui/` Visu-Editor | Playwright: jede Fähigkeit als Szenario (Vorher/Nachher-Zustand), Undo stellt exakt wieder her | C2, M |
| **C6 Editor: Dualität + Verlauf** (Micsi/openbridgeserver#173) | JSON-/Textansicht neben visuell, bidirektional (E13); Seitenversionen mit Wiederherstellen (E12) - Backend: Versionstabelle/`page_config`-Historie (kleiner A-Nachtrag) | `gui/` Visu-Editor, `obs/` | Playwright: Text-Edit → visuell sichtbar und umgekehrt; Version wiederherstellen == alter `GET` | A, C1, M |
| **D Admin-Integration + Doku + i18n** (Micsi/openbridgeserver#174) | Nav-Eintrag in `gui/`, Hilfeseiten für die neue Fläche (**Doku-Gate #1183**), de/en, `docs/AGENT_REFERENCE.md` GUI/i18n-Abschnitte sind Pflichtlektüre | `gui/`, `help/`, Locales | Doku-Gate + i18n-Hard-Gate + gui-Vitest grün | C4 |
| **E Messlatten-Harness** (Micsi/openbridgeserver#175) (von Tag 1 parallel, TDD) | `seed.py`: Popup-Seite, globale Include-Seite, individuelle Include-Seite, Include quer über Zugriffsgrenze; Specs: Edomi-Regeltabelle, authz über Include (R15), Editor-Round-Trip (R16) | `apps/visu/e2e/` | Die Specs **sind** die Messlatte; grün gegen echten Server, zweimal (non-flaky) | A0 (stubbt A bis es landet) |

**Parallelität:** M und A starten sofort (M braucht kein Backend, A ist Pilot). B, C1-C6, D, E starten gegen die A0-Form; C1-C6 zusätzlich erst, wenn M die Matrix belegt hat (sonst bauen sie gegen eine Hypothese). B/C/E arbeiten
mit Mock-/Seed-Daten, bis A landet; die **Integrationsrunde** am Ende lässt E gegen A+B+C
echt laufen. A ist Pilot: es läuft **zuerst vollständig durch** (Skill-Regel: ein Teil
beweist, dass die Messlatte trägt), die anderen starten, sobald A0 vom Owner freigegeben ist.

**Nicht in M5 (bewusst):** M4 PWA/Capacitor (Owner: „later"); Widget-Typen jenseits der 9
Kern-Typen; Migration von V1-Seiten in V2-Typen; Upstream-Lieferung. (Undo/Redo,
Mehrfachauswahl, Copy/Paste, Versionen sind gegen die Super-Set-Latte **drin**: C5/C6.)

## 4. Bremsen

- **20 Runden pro Teil** (Owner-Vorgabe der bisherigen Tracks), danach Zwischenstand zeigen.
- Bau-Agent ≠ Kritiker; der Kritiker urteilt am Artefakt (Testlauf, Screenshot, laufende
  Seite), nie an einer Zusammenfassung; Ablehnung benennt **was fehlt**.
- Pro Runde eine Zeile in §6; Abbruch = Zwischenstand als Ergebnis übergeben.
- Cross-repo (Contract 1.14) und jede `main`-Landung im Skins-Repo laufen über Fork-PR +
  Owner-Merge-Tap (Klassifizierer sperrt main-Mutationen); niemals `--no-verify`, Visu-Pushes
  mit `core.hooksPath=/dev/null`; kein `git stash` im geteilten Klon (Memory).

## 5. Gates je Teil (verbindlich, in jeden Subagent-Prompt kopieren)

Für `gui/`-Teile (C1-C6) zusätzlich die AGENTS.md-Gates: `cd gui && npm run build && npm run test && npm run test:coverage`,
`./tools/check-i18n-hardcoded-strings.sh` (harter Diff-Gate), `node tools/gui-coverage-summary.mjs --changed-only --threshold=70`;
Patch-Coverage Line **und** Branch (Codecov) - beide Seiten jeder neuen Bedingung testen.

- **Backend (A):** `tools/with-venv pytest tests/unit tests/adapters tests/contracts`, mit
  Docker `tests/integration` (`TMPDIR=/Volumes/Daten/tmp`), `./tools/lint.sh --check`,
  Coverage-Patch **Line + Branch** (Codecov-Regel), Migration gegen Bestands-DB.
- **App (B, C):** `pnpm -r build/typecheck`, `pnpm --filter @obs/visu-app test`, `pnpm lint`,
  `pnpm boundaries`, **Visual-Gate** bei UI (CONTRIBUTING-visu.md), Bundle-Größe Gast.
- **Contract 1.14:** Contract-Tests + ionic-Wächter (`targetsContract == version`) + Skins-Suite.
- **gui/ (D):** `npm run build && npm run test && npm run test:coverage`, i18n-Hard-Gate,
  Doku-Gate.
- **E:** zwei Läufe (frisch geseedet), Klassifikation pass/flaky/fail; Fail = Blocker.

## 6. Fortschrittsseite (nach jeder Runde aktualisieren)

Tracking: GitHub-Issues im Fork, Milestone M5 (Authoring + V2-Editor, Nr. 6), Sub-Issues #165-#175 unter Epic Micsi/openbridgeserver#84 (Owner-Entscheid: GitHub-Issues, kein Backlog.md).

| Teil | Runden gelaufen | Urteil des Kritikers | Stand |
|---|---|---|---|
| A0 Vorab-Entscheide | - | Owner-Entscheide 1-5 getroffen (§7, 2026-09-03) | durch |
| M Messlatten-Recherche (Micsi/openbridgeserver#165) | 3 | R3 Kritiker: g14c + E15 an der Quelle bestätigt, Zahlen exakt (31/25/42/7), jede Zeile mit Champion → **Messlatte tauglich** | durch |
| A Backend-Modell (Micsi/openbridgeserver#166) | 3 | R3 Kritiker: **Messlatte erreicht** (Härtung ohne Regression). Dedup-Validator sachlich korrekt (erstes Vorkommen gewinnt, keine Prüfung umgehbar); 8 geänderte Bestands-Mock-Zeilen sind reine `kind`-Additionen, keine Assertion entschärft; entfernter Fallback nachweislich unerreichbar (alle 7 Leser holen `SELECT *`); 4/4 Mutationen rot. Gates: lint grün, 7055 unit/adapters/contracts, 876 integration, V1 332/332 (Node 24), `models/visu.py` 100 %. Grenzen der Zusagen in §2.1 ergänzt; `copy_node` ohne Include-Validierung → #178 | **durch** |
| B Host-Komposition (Micsi/openbridgeserver#167) | 3 | R3 Kritiker: **Messlatte erreicht**, R2-R15 durchweg nachgewiesen. R1 zurückgewiesen (`composePopup` ohne Aufrufer: Popup-Regeln erreichten keinen Renderer, `kind` typseitig gelöscht), R2 zurückgewiesen (R15c griff auf der Startseite nicht, Timer beim Schliessen nicht abgeräumt → Wiederöffnen auf alter Frist). R3: `shownPageId` steht von Anfang an fest, Fristen für alle Fälle belegt; 11/16 Mutationen rot, die 5 Überlebenden sind äquivalente Bedingungs-Einfügungen ohne verdeckten Fehler; kein Bestandstest abgeschwächt. Gates: 39 Dateien / 635 Tests, lint 0, boundaries 0, Contract unberührt | **durch** |
| C1 Editor Baum+Eigenschaften (Micsi/openbridgeserver#168) | 0 | - | offen |
| C2 Editor WYSIWYG-Canvas (Micsi/openbridgeserver#169) | 0 | - | offen |
| C3 Editor Palette+Bindung (Micsi/openbridgeserver#170) | 0 | - | offen |
| C4 Vorschau-Brücke (Micsi/openbridgeserver#171) | 11 + Nachzug | Kritiker: **Messlatte erreicht**. Die Vorschau rendert über dieselbe Kette wie die echte Visu; Parität wird flächendeckend geprüft (Elementbaum, Stilblöcke, Selektorwirkung aller ausgelieferten Blätter, Rand ausserhalb des Rahmens, mehrere Zustände, drei Skins). Sicherheit über sechs Angriffsabläufe belegt, Session nur als Header. Gast-Bundle +1 829 B (+0,14 %), CSS unverändert. Der Weg dahin: R1 E3 strukturell unerreichbar (Protokoll ohne Theme/Tweaks), R3 Nachweis prüfte vier Punkte und war dazwischen blind, R5 Stilblock dicht aber alles daneben nicht, R6-R11 je 4 bis 8 Umgehungen im gebauten Bundle nachgewiesen und geschlossen. An Teil E übergeben, ehrlich begründet: was das gebaute Utility-Blatt berechnet, ob eine erreichende Regel ein Pixel bewegt, Viewport/Layout/Stapelung, das ausgelieferte Dokument, der Leseumfang | **durch** |
| C5 Editor Ergonomie (Micsi/openbridgeserver#172) | 0 | - | offen |
| C6 Editor Dualität+Verlauf (Micsi/openbridgeserver#173) | 0 | - | offen |
| D Admin+Doku+i18n (Micsi/openbridgeserver#174) | 0 | - | offen |
| E Messlatten-Harness (Micsi/openbridgeserver#175) | 4 | R4 Kritiker: **Messlatte erreicht**. 19 Szenarien laufen gegen das echte Backend, 20 bleiben `fixme` (nur der fehlende Editor C1-C6). R1 zurückgewiesen (E14 und E3 waren nie abnehmbar: Touch ausgeschlossen, Bilder verschiedener Größe byteweise verglichen), R2 erreicht mit einem Loch (`ignore_global_includes` von keinem laufenden Szenario gefangen), R3 zurückgewiesen (R7 überlebte seine eigene Mutation: 7-s-Retry verschluckte die verschobene Frist), R4: R7 misst jetzt zeitscharf, kleinste gefangene Verschiebung rund 350 ms, unter Last 20/20 grün. Zuordnung 35 Präfixe je genau einmal, Seed idempotent und selbstheilend, kein 429 | **durch** |
| Integrationsrunde (E gegen A+B+C) | 0 | - | offen |

## 7. Owner-Entscheide (getroffen am 2026-09-03)

1. **Editor-Ort:** Admin-GUI `gui/`, keine eigene App; Trennung Visu-Endpunkt ↔ Admin-Authoring (§2.4).
2. **Globale Includes:** Reihenfolge nach Knoten-`order` (§2.2).
3. **Branch-Basis:** `integ/visu-m5` vom Merge-Commit von #153, eigener Worktree (§2.5).
4. **Referenz-Editoren:** alle sechs aus §1.1 (Edomi, ioBroker vis-2, Home Assistant, Grafana, Timberwolf, smartVISU/TabletUI).
5. **Messlatte Editor:** Super-Set der besten Editoren, nicht V1-Parität (§1.1); Pixel-Autorenschaft ist Angebot, kein Zwang.
