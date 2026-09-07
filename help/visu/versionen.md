---
title: Versionen, JSON, Export und Import
---

# Versionen, JSON, Export und Import

Drei Wege, eine Seite außerhalb des Canvas zu behandeln: der Verlauf holt einen
früheren Stand zurück, die JSON-Ansicht zeigt dieselbe Seite als Text, und
Export und Import tragen sie als Datei aus der Anlage heraus und wieder herein.

## Versionen {#visu-versions}

**Verlauf** öffnet die Liste der gespeicherten Stände dieser Seite. Der oberste
Eintrag ist **Zuletzt gespeichert**, darunter stehen die früheren Versionen.

**Wiederherstellen** setzt die Seite auf den gewählten Stand zurück. Dabei
passiert Folgendes, und zwar in dieser Reihenfolge:

1. Der Canvas wird vom Schirm genommen. Er hält einen Entwurf, der ab diesem
   Augenblick nicht mehr die Seite beschreibt.
2. Die Seiteneigenschaften werden gesperrt, damit nicht ein Klick auf ihr
   "Speichern" den alten Entwurf über den gerade zurückgeholten Stand schreibt.
3. Der alte Stand wird gelesen und über den ganz normalen Speicherweg abgelegt.
   Es gibt bewusst keinen eigenen Wiederherstellungsweg, der an der Prüfung des
   Seitentyp-Modells vorbeikäme.
4. Erst wenn die Seite zurückgelesen ist und den alten Stand wirklich trägt,
   erscheint die Quittung und der Canvas kommt zurück.

Das Wiederherstellen legt selbst wieder eine Version an. Der Weg zurück zum
Stand von vorhin bleibt damit offen.

## JSON-Ansicht {#visu-json-view}

Über den Reitern **Visuell** und **JSON** steht dieselbe Seite in zwei
Ansichten, und beide sind bearbeitbar:

- Eine Verschiebung auf dem Canvas erscheint sofort im JSON.
- Eine Änderung im JSON schlägt auf den Canvas durch.

Was der Editor dabei ablehnt, sagt er:

- **Kein gültiges JSON**: die Eingabe wird nicht übernommen, der letzte gute
  Stand bleibt stehen.
- **Kein Seitendokument**: das JSON braucht eine Liste `widgets`, und jedes
  Element darin eine `id`.

Gespeichert wird auch hier über **Speichern**; die Textansicht ist ein zweiter
Blick auf denselben Entwurf, kein zweiter Schreibweg.

## Export und Import {#visu-transfer}

**Exportieren** lädt die aktuelle Seite als Datei herunter, samt allem, was im
Seitenbaum darunter hängt.

**Importieren** liest eine solche Datei wieder ein. Dabei entsteht eine
**eigene, neue Seite** auf der obersten Ebene: neue Ids, ein eindeutiger Name
("Name (Kopie 1)", falls der Name schon vergeben ist). Der Import ist also ein
Vervielfältigen, kein Ersetzen.

Zwei Dinge kommen bewusst **nicht** mit, und der Editor sagt beide laut:

- **PIN-Schutz ohne PIN.** Ein Export trägt kein Geheimnis. Eine
  PIN-geschützte Seite bleibt geschützt, hat aber keine PIN mehr; bis in den
  Seiteneigenschaften eine neue gesetzt ist, kommt niemand hinein.
- **Felder einer neueren Version.** Wird eine Datei aus einer neueren
  OBS-Version eingelesen, fällt weg, was diese Version nicht kennt. Der Editor
  zählt die betroffenen Felder auf, statt sie still zu verwerfen.

Eine Datei, die gar kein Visu-Export ist, wird sofort abgelehnt, damit der
Fehlgriff in den falschen Ordner erkennbar bleibt.
