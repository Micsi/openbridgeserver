---
title: Canvas und Elemente
---

# Canvas und Elemente

Auf dem Canvas entsteht die Seite. Die Elemente kommen aus der Palette, ihre
Bindung an einen Datenpunkt und ihre Sichtbarkeitsregel stehen im Formular
darunter.

## Der Canvas {#visu-editor-canvas}

Der Canvas zeigt die Elemente der ausgewaehlten Seite. Ueber ihm liegen zwei
Werkzeugleisten: die obere fuer Layout und Ausrichtung, die untere fuer die
Ergonomie.

Was der Canvas kann:

- **Ziehen und Groesserziehen** setzt Lage und Groesse. Beides rastet an der
  eingestellten **Rasterweite** ein.
- **Ausrichtlinien** erscheinen, sobald zwei Kanten dicht beieinander liegen.
- **Verteilen** macht die Abstaende gleich. Das ist erst ab drei ausgewaehlten
  Elementen eine Aussage; bei zwei Elementen bleibt die Schaltflaeche gesperrt.
- **Gleiche Groesse** uebernimmt die Masse des zuerst gewaehlten Elements.
- **Nach vorne** und **Nach hinten** aendern die Z-Ordnung.
- **Gesperrt** schuetzt ein Element vor Aenderungen, **Ausgeblendet** nimmt es
  aus der Anzeige, ohne es zu loeschen.
- **Mehrfachauswahl** per Aufziehrahmen oder mit gedrueckter Umschalttaste;
  ausgewaehlte Elemente lassen sich gemeinsam ziehen und **Gruppieren**.
- **Kopieren**, **Einfuegen** und **Duplizieren** funktionieren auch ueber
  Seitengrenzen hinweg.
- **Rueckgaengig** und **Wiederherstellen** fuehren einen Stapel der letzten
  Zustaende. Die Pfeiltasten verschieben das ausgewaehlte Element pixelweise.

Gespeichert wird ueber **Speichern**. Die einzige Ausnahme ist die Reihenfolge
im responsiven Modus: sie wird sofort gesichert, weil sie dort die einzige
Aussage ueber die Anordnung ist.

Der Canvas zeigt auch die Ebenen, die nicht der Seite selbst gehoeren:
**Globale Layer** und **Include-Layer** lassen sich ein- und ausblenden, damit
der Autor sieht, worauf er baut, ohne es versehentlich zu bearbeiten.

## Pixelgenau oder responsiv {#visu-layout-modes}

Jede Seite ist in genau einem der beiden Modi verfasst. Der **Layout-Modus**
steht in der oberen Werkzeugleiste.

| Modus | Was zaehlt | Wofuer |
|---|---|---|
| **Pixel** | Koordinaten X, Y, Breite, Hoehe | Grundrisse, Anlagenbilder, feste Bildschirme |
| **Responsiv** | nur Reihenfolge und Gruppierung | Telefon, Tablet, wechselnde Fensterbreiten |

Pixelgenaues Verfassen ist ein **Angebot, kein Zwang**. Wer responsiv arbeitet,
sieht keine Koordinatenfelder; die Anordnung entsteht per Ziehen in der
Reihenfolge.

**Die Koordinaten bleiben trotzdem stehen.** Ein Wechsel nach Responsiv loescht
keine Zahl, er schaltet nur ihre Wirkung ab; der Rueckweg nach Pixel gibt genau
die Lage zurueck, die zuletzt gesetzt war. Das ist auch der Grund, warum die
Visu 1 dieselbe Seite unveraendert lesen kann.

**Welcher Modus wirklich gezeichnet wird, entscheidet der Skin.** Ein
seitenbesitzender Skin wertet Koordinaten aus, ein listenartiger Skin nur die
Reihenfolge. Der Editor schreibt unter der Werkzeugleiste, was der gewaehlte
Skin daraus macht.

Die **Breakpoints** gehoeren zur Seite, nicht zum Element. Sie stehen als Liste
von Pixelbreiten in der Werkzeugleiste; **Vorschau-Breite** stellt den Rahmen
auf einen davon, um die Seite in dieser Breite zu pruefen.

## Widget-Palette {#visu-widget-palette}

Die Palette bietet die Kern-Widget-Typen an: Licht, Schalter, Rollladen,
Jalousie, Messwert, Szene, Medien, Kamera, Klima. Ein Klick setzt ein neues
Element auf die Seite.

Jeder Typ hat sein eigenes Formular, und die Felder darin sind nicht frei
erfunden: sie stammen aus derselben Abbildung, die die Visu beim Rendern
benutzt. Ein Typ, den die Vorschau heute noch nicht rendert, ist in der Palette
als solcher gekennzeichnet, statt still leer zu bleiben.

## Datenpunkt-Bindung {#visu-datapoint-binding}

Ein Element wird ueber **Datenpunkt waehlen** an einen Datenpunkt gebunden. Der
Waehler sucht **auf dem Server**, nicht in einer im Browser gehaltenen Liste, und
er filtert zusaetzlich nach Datentyp. Damit bleibt er auch in einer Anlage mit
Tausenden Datenpunkten brauchbar.

Je nach Widget-Typ gibt es mehrere Bindungen: ein Licht kennt Schalten, Dimmen
und die zugehoerigen Status-Datenpunkte, ein Rollladen Position und Sperre, und
so fort. Jedes Feld hat seinen eigenen Waehler.

Der gebundene Wert erscheint sofort in der [Vorschau](/visu/#visu-editor-preview),
und zwar als **Live-Wert vom Server**. Wer den Datenpunkt zur Kontrolle
umschaltet, sieht die Aenderung im Editor, ohne neu zu laden.

## Bedingte Sichtbarkeit {#visu-visibility-rule}

Ueber **Sichtbarkeitsregel** bekommt ein Element eine Bedingung: es erscheint
nur, wenn sie erfuellt ist.

Eine Regel besteht aus drei Angaben:

- **Datenpunkt**, dessen Wert beobachtet wird,
- **Bedingung**: gleich, ungleich, kleiner als, kleiner oder gleich, groesser
  als, groesser oder gleich, wahr, falsch,
- **Schwelle**, gegen die verglichen wird. Bei "wahr" und "falsch" entfaellt
  sie.

Die Regel wirkt **im Host**, also an derselben Stelle wie in der laufenden Visu.
Deshalb zeigt die Vorschau genau das, was der Nutzer sehen wird, und die Regel
gilt auch auf Include- und Popup-Ebenen. Ein angemeldeter Betrachter sieht die
Aenderung nahezu sofort, ein Gast im Abfragetakt der Gast-Ansicht.

**Regel entfernen** nimmt die Bedingung wieder weg; das Element ist dann immer
sichtbar.
