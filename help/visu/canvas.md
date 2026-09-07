---
title: Canvas und Elemente
---

# Canvas und Elemente

Auf dem Canvas entsteht die Seite. Die Elemente kommen aus der Palette, ihre
Bindung an einen Datenpunkt und ihre Sichtbarkeitsregel stehen im Formular
darunter.

## Der Canvas {#visu-editor-canvas}

Der Canvas zeigt die Elemente der ausgewählten Seite. Über ihm liegen zwei
Werkzeugleisten: die obere für Layout und Ausrichtung, die untere für die
Ergonomie.

Was der Canvas kann:

- **Ziehen und Größerziehen** setzt Lage und Größe. Beides rastet an der
  eingestellten **Rasterweite** ein.
- **Ausrichtlinien** erscheinen, sobald zwei Kanten dicht beieinander liegen.
- **Verteilen** macht die Abstände gleich. Das ist erst ab drei ausgewählten
  Elementen eine Aussage; bei zwei Elementen bleibt die Schaltfläche gesperrt.
- **Gleiche Größe** übernimmt die Maße des zuerst gewählten Elements.
- **Nach vorne** und **Nach hinten** ändern die Z-Ordnung.
- **Gesperrt** schützt ein Element vor Änderungen, **Ausgeblendet** nimmt es
  aus der Anzeige, ohne es zu löschen.
- **Mehrfachauswahl** per Aufziehrahmen oder mit gedrückter Umschalttaste;
  ausgewählte Elemente lassen sich gemeinsam ziehen und **Gruppieren**.
- **Kopieren**, **Einfügen** und **Duplizieren** funktionieren auch über
  Seitengrenzen hinweg.
- **Rückgängig** und **Wiederherstellen** führen einen Stapel der letzten
  Zustände. Die Pfeiltasten verschieben das ausgewählte Element pixelweise.

Gespeichert wird über **Speichern**. Die einzige Ausnahme ist die Reihenfolge
im responsiven Modus: sie wird sofort gesichert, weil sie dort die einzige
Aussage über die Anordnung ist.

Der Canvas zeigt auch die Ebenen, die nicht der Seite selbst gehören:
**Globale Layer** und **Include-Layer** lassen sich ein- und ausblenden, damit
der Autor sieht, worauf er baut, ohne es versehentlich zu bearbeiten.

## Pixelgenau oder responsiv {#visu-layout-modes}

Jede Seite ist in genau einem der beiden Modi verfasst. Der **Layout-Modus**
steht in der oberen Werkzeugleiste.

| Modus | Was zählt | Wofür |
|---|---|---|
| **Pixel** | Koordinaten X, Y, Breite, Höhe | Grundrisse, Anlagenbilder, feste Bildschirme |
| **Responsiv** | nur Reihenfolge und Gruppierung | Telefon, Tablet, wechselnde Fensterbreiten |

Pixelgenaues Verfassen ist ein **Angebot, kein Zwang**. Wer responsiv arbeitet,
sieht keine Koordinatenfelder; die Anordnung entsteht per Ziehen in der
Reihenfolge.

**Die Koordinaten bleiben trotzdem stehen.** Ein Wechsel nach Responsiv löscht
keine Zahl, er schaltet nur ihre Wirkung ab; der Rückweg nach Pixel gibt genau
die Lage zurück, die zuletzt gesetzt war. Das ist auch der Grund, warum die
Visu 1 dieselbe Seite unverändert lesen kann.

**Welcher Modus wirklich gezeichnet wird, entscheidet der Skin.** Ein
seitenbesitzender Skin wertet Koordinaten aus, ein listenartiger Skin nur die
Reihenfolge. Der Editor schreibt unter der Werkzeugleiste, was der gewählte
Skin daraus macht.

Die **Breakpoints** gehören zur Seite, nicht zum Element. Sie stehen als Liste
von Pixelbreiten in der Werkzeugleiste; **Vorschau-Breite** stellt den Rahmen
auf einen davon, um die Seite in dieser Breite zu prüfen.

## Widget-Palette {#visu-widget-palette}

Die Palette bietet die Kern-Widget-Typen an: Licht, Schalter, Rollladen,
Jalousie, Messwert, Szene, Medien, Kamera, Klima. Ein Klick setzt ein neues
Element auf die Seite.

Jeder Typ hat sein eigenes Formular, und die Felder darin sind nicht frei
erfunden: sie stammen aus derselben Abbildung, die die Visu beim Rendern
benutzt. Ein Typ, den die Vorschau heute noch nicht rendert, ist in der Palette
als solcher gekennzeichnet, statt still leer zu bleiben.

## Datenpunkt-Bindung {#visu-datapoint-binding}

Ein Element wird über **Datenpunkt wählen** an einen Datenpunkt gebunden. Der
Wähler sucht **auf dem Server**, nicht in einer im Browser gehaltenen Liste, und
er filtert zusätzlich nach Datentyp. Damit bleibt er auch in einer Anlage mit
Tausenden Datenpunkten brauchbar.

Je nach Widget-Typ gibt es mehrere Bindungen: ein Licht kennt Schalten, Dimmen
und die zugehörigen Status-Datenpunkte, ein Rollladen Position und Sperre, und
so fort. Jedes Feld hat seinen eigenen Wähler.

Der gebundene Wert erscheint sofort in der [Vorschau](/visu/#visu-editor-preview),
und zwar als **Live-Wert vom Server**. Wer den Datenpunkt zur Kontrolle
umschaltet, sieht die Änderung im Editor, ohne neu zu laden.

## Bedingte Sichtbarkeit {#visu-visibility-rule}

Über **Sichtbarkeitsregel** bekommt ein Element eine Bedingung: es erscheint
nur, wenn sie erfüllt ist.

Eine Regel besteht aus drei Angaben:

- **Datenpunkt**, dessen Wert beobachtet wird,
- **Bedingung**: gleich, ungleich, kleiner als, kleiner oder gleich, größer
  als, größer oder gleich, wahr, falsch,
- **Schwelle**, gegen die verglichen wird. Bei "wahr" und "falsch" entfällt
  sie.

Die Regel wirkt **im Host**, also an derselben Stelle wie in der laufenden Visu.
Deshalb zeigt die Vorschau genau das, was der Nutzer sehen wird, und die Regel
gilt auch auf Include- und Popup-Ebenen. Ein angemeldeter Betrachter sieht die
Änderung nahezu sofort, ein Gast im Abfragetakt der Gast-Ansicht.

**Regel entfernen** nimmt die Bedingung wieder weg; das Element ist dann immer
sichtbar.
