---
title: Versionen, JSON, Export und Import
---

# Versionen, JSON, Export und Import

Drei Wege, eine Seite ausserhalb des Canvas zu behandeln: der Verlauf holt einen
frueheren Stand zurueck, die JSON-Ansicht zeigt dieselbe Seite als Text, und
Export und Import tragen sie als Datei aus der Anlage heraus und wieder herein.

## Versionen {#visu-versions}

**Verlauf** oeffnet die Liste der gespeicherten Staende dieser Seite. Der oberste
Eintrag ist **Zuletzt gespeichert**, darunter stehen die frueheren Versionen.

**Wiederherstellen** setzt die Seite auf den gewaehlten Stand zurueck. Dabei
passiert Folgendes, und zwar in dieser Reihenfolge:

1. Der Canvas wird vom Schirm genommen. Er haelt einen Entwurf, der ab diesem
   Augenblick nicht mehr die Seite beschreibt.
2. Die Seiteneigenschaften werden gesperrt, damit nicht ein Klick auf ihr
   "Speichern" den alten Entwurf ueber den gerade zurueckgeholten Stand schreibt.
3. Der alte Stand wird gelesen und ueber den ganz normalen Speicherweg abgelegt.
   Es gibt bewusst keinen eigenen Wiederherstellungsweg, der an der Pruefung des
   Seitentyp-Modells vorbeikaeme.
4. Erst wenn die Seite zurueckgelesen ist und den alten Stand wirklich traegt,
   erscheint die Quittung und der Canvas kommt zurueck.

Das Wiederherstellen legt selbst wieder eine Version an. Der Weg zurueck zum
Stand von vorhin bleibt damit offen.

## JSON-Ansicht {#visu-json-view}

Ueber den Reitern **Visuell** und **JSON** steht dieselbe Seite in zwei
Ansichten, und beide sind bearbeitbar:

- Eine Verschiebung auf dem Canvas erscheint sofort im JSON.
- Eine Aenderung im JSON schlaegt auf den Canvas durch.

Was der Editor dabei ablehnt, sagt er:

- **Kein gueltiges JSON**: die Eingabe wird nicht uebernommen, der letzte gute
  Stand bleibt stehen.
- **Kein Seitendokument**: das JSON braucht eine Liste `widgets`, und jedes
  Element darin eine `id`.

Gespeichert wird auch hier ueber **Speichern**; die Textansicht ist ein zweiter
Blick auf denselben Entwurf, kein zweiter Schreibweg.

## Export und Import {#visu-transfer}

**Exportieren** laedt die aktuelle Seite als Datei herunter, samt allem, was im
Seitenbaum darunter haengt.

**Importieren** liest eine solche Datei wieder ein. Dabei entsteht eine
**eigene, neue Seite** auf der obersten Ebene: neue Ids, ein eindeutiger Name
("Name (Kopie 1)", falls der Name schon vergeben ist). Der Import ist also ein
Vervielfaeltigen, kein Ersetzen.

Zwei Dinge kommen bewusst **nicht** mit, und der Editor sagt beide laut:

- **PIN-Schutz ohne PIN.** Ein Export traegt kein Geheimnis. Eine
  PIN-geschuetzte Seite bleibt geschuetzt, hat aber keine PIN mehr; bis in den
  Seiteneigenschaften eine neue gesetzt ist, kommt niemand hinein.
- **Felder einer neueren Version.** Wird eine Datei aus einer neueren
  OBS-Version eingelesen, faellt weg, was diese Version nicht kennt. Der Editor
  zaehlt die betroffenen Felder auf, statt sie still zu verwerfen.

Eine Datei, die gar kein Visu-Export ist, wird sofort abgelehnt, damit der
Fehlgriff in den falschen Ordner erkennbar bleibt.
