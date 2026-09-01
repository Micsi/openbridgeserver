# Contributing - Visu Seiten-Layering & Komposition (Visu 2.0)

> Plan-/Design-Dok fuer die Welle **Seiten-Layering** (Upstream #1195, verwandt #1194).
> Erst lesen, dann implementieren. Aufbau wie die vorigen Track-Doks
> (`CONTRIBUTING-visu-authz.md`, `-designsystem.md`): Leitsatz, Modell, Wellen, Gates.

## 0. Leitsatz (die eine Regel)

**Layering und Komposition sind eine SKIN-Faehigkeit, kein festes Verhalten.**
Host und Vertrag liefern das **Rohmaterial** (Seiten-/Layer-Komposition, Spatial-Daten
`x/y/w/h`, Popup-Deskriptoren, Navigations-Baum). **Das „wie" definiert der Skin-Autor.**

- Die **Haupt-Visu (ionic-Skin)** ist **responsiv**: Burger-Nav, semantische Raum-/Sektions-
  gruppierung, **ignoriert** Pixel-Koordinaten. Sie deklariert `honors: []` fuer die neuen
  Spatial-/Layer-Hints - alles additiv und ignorierbar (Golden Rule 5: Ordnung+Gruppierung
  sind der Boden, Spatial/Layer sind Zugabe).
- Ein **pixelgenauer Skin** (POC „Edomi", siehe §5) **honoriert** `x/y/w/h`, rendert Popups
  pixelgenau und legt globale Layer als absolute Overlays uebereinander - „das Beste aus der
  Edomi-Welt".

Damit bleibt jede Golden Rule erhalten: Daten=JSON / Verhalten=Code (Komposition ist Daten,
das Rendern ist Skin-Code); Skin besitzt nie State; Renderer nach Typ adressiert; Skin per
Manifest adressiert; AA-Pflicht; Reihenfolge+Gruppierung als Boden.

## 1. Das Kompositionsmodell (Edomi-Konzepte, abstrahiert)

Aus der Edomi-Visu-Seitenhilfe uebernommen, auf unser skin-neutrales Modell abgebildet:

| Edomi-Konzept | Bedeutung | Contract/Host liefert | ionic (responsiv) | POC „Edomi" |
|---|---|---|---|---|
| **Normale Seite** | gewoehnliche Visuseite | Widgets + Spatial `x/y/w/h` | semantische Gruppierung, Koordinaten ignoriert | pixelgenaues Grid |
| **Popup** | modale Overlay-Seite mit Position/Groesse, Auto-Close, Exklusiv/Modal, Animation, Schatten, Abdunkeln | Popup-Deskriptor (siehe §2.3) | modales Sheet (responsiv, zentriert) | pixelgenaues Popup an `x/y`, wie Edomi |
| **Inkludeseite (individuell)** | eine Seite bettet den Inhalt einer anderen ein | Kompositions-Referenz | eingebetteter Abschnitt | eingebetteter Layer |
| **Globale Inkludeseite** | wird **automatisch in jede** normale Seite eingebettet (nicht in Popups); Stapelung nach Ordnung; pro Seite abwaehlbar; eine Ebene tief | globaler Layer-Stack + Opt-out-Flag | globale Sektion/Nav | globaler Overlay-Layer (Menue/Chrome) |

**Globale Inkludeseite = globaler Layer:** einmal gepflegt (z.B. Hauptmenue, Status/Uhr),
erscheint automatisch auf jeder normalen Seite. Reihenfolge deterministisch (aufsteigend).
Eine normale Seite kann globale Layer ignorieren. Popups erhalten keine globalen Layer.

Die **effektive Seite**, die der Host an den Skin uebergibt, ist ein **geordneter Layer-Stack**:

```
effektive Seite = [ globale Layer (in Ordnung) ] + [ individuelle Includes ] + [ eigener Inhalt ]
Popups          = separate Overlay-Deskriptoren, die der Skin modal rendert
```

Der Host **komponiert**; der Skin **rendert den Stack frei** (uebereinander/absolut, oder
flach/semantisch - Skin-Entscheidung).

## 2. Vertrags-Oberflaeche (Welle 1, additiv, semver-minor)

Alles **optional/additiv** - ein Skin, der nichts davon honoriert, verhaelt sich unveraendert.

### 2.1 Spatial-Hint pro platziertem Element
```ts
/** Pixel-/Rasterposition eines Widgets auf seiner Seite (Edomi-Autoren-Layout).
 *  Additiv und ignorierbar: responsive Skins nutzen Role/span; Pixel-Skins honorieren dies. */
export interface WidgetPosition {
  readonly x: number; readonly y: number;   // Ursprung (Autoren-Einheit, i.d.R. px)
  readonly w: number; readonly h: number;   // Groesse
}
```
Getragen als optionales `position?` auf dem platzierten Element (Host-Layout-Ausgabe).

### 2.2 Layer-/Kompositionsmodell (skin-facing)
```ts
export type PageKind = 'normal' | 'popup' | 'globalInclude';

/** Ein Layer der komponierten Seite (globaler Include, individueller Include, oder eigen). */
export interface PageLayer {
  readonly id: string;
  readonly origin: 'global' | 'include' | 'own';
  readonly order: number;               // deterministische Stapelreihenfolge
  /** Die platzierten Elemente dieses Layers (mit optionalem WidgetPosition). */
  readonly items: readonly PlacedRef[]; // PlacedRef = { id, role, position? } (Host-Ausgabe)
}
```

### 2.3 Popup-Deskriptor
```ts
export interface PopupDescriptor {
  readonly id: string;
  readonly position?: WidgetPosition;   // leer => zentriert (Edomi-Semantik)
  readonly autoCloseMs?: number;        // 0/undefined => bleibt offen
  readonly modal?: boolean;             // „Exklusiv oeffnen": ausserhalb inert
  readonly animate?: boolean;
  readonly shadow?: boolean;
  readonly dimBackdrop?: boolean;
}
```
Mehrere verschiedene Popups koennen gleichzeitig offen sein. Auto-Close verlaengert sich
beim erneuten Oeffnen **nicht** (Edomi-Regel) - Host-Timer-Semantik.

### 2.4 Skin-Kapazitaet
`SkinLayout.honors` erhaelt anerkannte Strings: `'position'`, `'layers'`, `'popup'`.
Der ionic-Skin deklariert keine davon (bleibt responsiv). Der POC-Skin deklariert alle.

## 3. Wellen (cross-repo, skins-first wie im Sprint ueblich)

- **W1 Contract:** §2-Typen additiv + `honors`-Strings; Version-Bump 1.8 -> **1.9**; CHANGELOG;
  Vitest fuer die neuen Typen/Schema. Gate: `pnpm -r build/typecheck`, contract-tests.
- **W2 Skins:** `targetsContract` -> 1.9 (ionic + terminal), ionic deklariert `honors: []`
  (unveraendert responsiv). Gate: ionic-Waechter (targetsContract==version), skins-CI. **Zuerst.**
- **W3 Host:** Mapper traegt `x/y/w/h` aus dem Backend-`page_config` durch (verwirft sie nicht
  mehr); Host komponiert den Layer-Stack (zunaechst aus der `parent_id`-Kette als globale/Include-
  Layer-Naeherung) und reicht `position`/`layers` an Skins; Popup-Host-Timer/Modal-Semantik.
  Gate: vitest, boundaries, Visual-Gate.
- **W4 POC-Skin „Edomi":** neuer Skin, honoriert `position`+`layers`+`popup`, pixelgenaue
  Popups + globale Overlay-Layer. Beweist die Kapazitaet; ionic bleibt Referenz-Responsive.

**M5 (spaeter, separat): Authoring + Backend-Modell.** Erst-klassige Seitentypen (popup /
globalInclude / include-Referenzen) im Backend-Visu-Modell **plus** deren Bedienung im neuen
**V2-Editor**. W1-W3 sind bewusst frontend-/contract-first: der Host komponiert aus dem, was
das Backend heute liefert (`parent_id`-Baum + `page_config` inkl. `x/y/w/h`); die reichen
Seitentypen fuellt das Authoring in M5 nach.

## 4. Golden-Rule- und Architektur-Treue (Selbstpruefung)

- **Additiv/ignorierbar:** Kein bestehender Skin bricht; ohne `honors` = heutiges Verhalten.
- **Skin stateless:** Popup-Offen-Zustand + Auto-Close-Timer besitzt der **Host**, nicht der Skin.
- **Boden bleibt:** Reihenfolge+Gruppierung fuehren; `position`/`layers` sind Zugabe.
- **Kein Datenfork:** Layer referenzieren dieselben Geraete per id; keine Kopien.
- **Renderer nach Typ, Skin per Name:** unveraendert.

## 5. POC-Skin „Edomi" (Zielbild)

Ein eigenstaendiger Skin im `obs-visu-skins`-Repo, der zeigt, was ein Autor bauen **kann**:
pixelgenaues Widget-Grid (`x/y/w/h`), Popups exakt an `x/y` mit Schatten/Abdunkeln/Animation/
Modal/Auto-Close, globale Include-Layer als absolute Overlays (Menue/Chrome). Kein Zwang fuer
die Haupt-Visu - diese bleibt responsiv. „Edomi ist beruehmt fuer Pixelgenauigkeit; wer das
will, soll es koennen."

## 6. Offene Punkte / Entscheidungen

- **Autoren-Einheit von `x/y/w/h`:** px vs. relatives Raster - im Contract als opake Zahlen,
  Interpretation beim Pixel-Skin (Edomi: px). Responsive Skins ignorieren ohnehin.
- **Layer-Herleitung in W3:** zunaechst aus `parent_id` (Naeherung fuer global/include), bis das
  Backend-Modell (M5) explizite Include-/Global-/Popup-Flags traegt.
- **#1194 (Seiten-Verlinkung):** faellt natuerlich mit dem Nav-Baum/Popup-Modell zusammen -
  als Folge-Welle nach W3 einplanen.
