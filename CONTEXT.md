# obs Visu

Die mobile Visualisierung von obs: eine eigene Vue-3-App (`apps/visu`), die Geräte
über einen versionierten Vertrag (`@obs/visu-contract`) beschreibt und das Zeichnen
an austauschbare Skins abgibt. Dieses Glossar hält die Begriffe fest, die in diesem
Projekt mehrfach belegt sind — jeder Eintrag benennt genau eine Bedeutung.

## Die zwei Visus

**Visu**:
Die App unter `apps/visu`, gegen `@obs/visu-contract` gebaut, mit Skins gezeichnet.
Gemeint ist immer diese, wenn nichts anderes dabeisteht. Was man auf dem Bildschirm
sieht, ist nicht die Visu, sondern ihr Skin.
_Avoid_: Visu v2, neue Visu, Mobile-App, Visu-SPA; „die Visu" für das Erscheinungsbild

**Alt-Visu**:
Die ältere Visualisierung unter `frontend/`, gebaut nach `frontend_dist/` und heute
unter `/visu` ausgeliefert. Sie bringt ihren eigenen Seiten-Editor und eine eigene
Widget-Registry mit.
_Avoid_: Visu v1, die Visu, frontend

## Struktur und Zeichnung

**Skin**:
Ein Paket mit eigener Optik, das für Gerätetypen Renderer liefert, Icon-Sets führt und
im Manifest erklärt, was es nicht unterstützt. Jeder Skin trägt eigene Optik-Regeln;
die Marke OBS bestimmt sie nicht. Ein Skin besitzt keinen Zustand.
_Avoid_: Theme, Design, Layout-Paket, „eine Visu", Visu-Optik

**Gerätetyp**:
Eine der dreizehn Kategorien des Vertrags (`light`, `blind`, `jalousie`, `climate`,
`scene`, `sensor`, `camera`, `media`, `energy`, `weather`, `alarm`, `chart`,
`switch`), für die ein Skin einen Renderer bereitstellt.
_Avoid_: Widget-Typ, Kachel-Typ

**Alt-Widget**:
Ein Eintrag der Widget-Registry der Alt-Visu (26 Stück, etwa `Chart`, `Grundriss`,
`Zeitschaltuhr`). Drei davon haben ein Gegenstück im Vertrag; die übrigen zeichnet
die Visu nicht.
_Avoid_: Widget (ohne Zusatz), Visu-Widget

**Visu-Baum**:
Die Seitenstruktur in `visu_nodes` — `LOCATION`- und `PAGE`-Knoten, wobei eine
Seite ihre Bestückung in `page_config.widgets` trägt. Quelle von `/api/v1/visu/tree`.
_Avoid_: Seitenbaum, Visu-Hierarchie, Tree

**Hierarchie**:
Die Gerätestruktur in `hierarchy_nodes` — Gebäude, Räume, Gewerke, meist aus einem
ETS-Import. Sie ist nicht der Visu-Baum und wird nicht automatisch in ihn überführt.
_Avoid_: Gebäudebaum, Struktur, Tree

## Icons

Die Begriffe dieses Abschnitts folgen der Icon-Domäne des BrandKits
(`quality-loop/icon-domain/CONTEXT.md`); dort steht die vollständige Fassung samt
Prüfbegriffen. Hier stehen nur die Begriffe, die in der Visu selbst vorkommen, und
der eine, den das BrandKit nicht kennt. Abweichend vom BrandKit ist die normative
Ebene das Icon-Set, nicht die Marke.

**Slot**:
Eine benannte Stelle im Vertrag, die nach einem Zeichen verlangt (`bulb`, `thermo`,
`lock`). Der Slot ist die Bestellung, nicht die Ware: `ctx.icon(gerät, slot)` löst
ihn zur Zeichnung auf. Das BrandKit kennt diesen Begriff nicht — dort ist die
kleinste Einheit das Icon selbst.
_Avoid_: Icon-Name, Symbolname, Key

**Icon**:
Ein einzelnes Zeichen mit einer Bedeutung, als Vektor gezeichnet und in einer
Zielgröße beurteilt. In der Visu liegt es als innerer SVG-Rumpf vor, ohne eigene
Farbe.
_Avoid_: Symbol, Glyphe, Piktogramm, Grafik

**Icon-Set**:
Eine Menge von Icons, die zusammen einen Stil bildet und gemeinsame Vorgaben trägt —
Farbanzahl, Zielgröße, Format, Hintergrund, zulässige Zustände. Das Set trägt
Regeln, die kein einzelnes Icon tragen kann. Ein Skin kann mehrere Icon-Sets mit
verschiedener Optik führen.
_Avoid_: Icon-Familie, Bibliothek, Sammlung, Pack

**Glyph**:
Eine parametrische Zeichnung, deren Form sich mit einem Gerätewert ändert — etwa
`BlindGlyph`, dessen Verschattung mit `position` 0…100 stufenlos wächst. Ein Glyph
ist kein Icon: er hat keine feste Form und lässt sich nicht als Datei ausliefern.
_Avoid_: dynamisches Icon, Live-Icon, Status-Icon

**Bauregel**:
Eine objektiv prüfbare Zahl eines Stils: Grundraster, Strichstärke, Eckenradius,
Endungsform, Farbanzahl, Flächenanteil. Bauregeln sind das Normative — sie gehören
zum Icon-Set, die erzeugten Icons sind ihr Ergebnis.
_Avoid_: Designtoken, Stilregel, Parameter, Guideline

**Betriebsart**:
Die Festlegung, woher der Stil kommt und wogegen geprüft wird: **Ergänzung** (ein
fremdes System ist im Einsatz, seine Bauregeln werden gemessen) oder **Eigenstil**
(der Stil wird aus den bestätigten Optik-Entscheidungen des Skins abgeleitet). Sie wird je Lauf
gewählt und bestimmt die Messlatte.
_Avoid_: Modus, Szenario, Variante des Laufs

**Stilreferenz**:
Ein fremdes, benanntes Icon-System, dessen Aussehen getroffen werden soll. Existiert
nur in der Betriebsart Ergänzung. Übernommen werden seine Bauregeln, niemals seine
Formen.
_Avoid_: Vorbild, Vorlage, Inspiration

**Qualitätsreferenz**:
Ein fremdes, benanntes Icon-System, das als Maßstab für die handwerkliche Ausführung
dient, nicht für das Aussehen: Rastertreue, Strichdisziplin, Reduktionsgrad,
Set-Konsistenz. Im Eigenstil ersetzt sie die Stilreferenz als Messlatte.
_Avoid_: Benchmark, Vergleichssystem, Vorbild

**Zielgröße**:
Die Pixelgröße, in der ein Icon verbindlich beurteilt wird. In der Visu ist das 18 px
— die Voreinstellung von `svgIcon` —, mit 14 px als Nebenbedingung, weil das
Sperr-Symbol auf der Kachel dort sitzt.
_Avoid_: Standardgröße, Anzeigegröße, Rendergröße

**Farbrolle**:
Die Einstufung eines Farb-Tokens für die Kontrastmessung: `text` (4,5:1), `graphic`
(3:1), `ground` (Fläche, auf der Vordergrund steht) oder `exempt`. Eine Ausnahme ohne
Begründung ist ein Befund — eine Auslassung muss eine Aussage sein.
_Avoid_: Farbtyp, Kategorie, Token-Art

**Lücke**:
Ein Slot, den der Vertrag verlangt und den niemand liefert. Sie zählt im
Konformitätsreport als `gap`; ein bewusst nicht geliefertes Zeichen gehört stattdessen
als `unsupported` ins Manifest. Ein still leer gerendertes Zeichen ist keins von
beidem, sondern ein Vergessen.
_Avoid_: fehlendes Icon, Leerstelle, Fallback
