---
title: Visu-Editor
---

# Visu-Editor der Admin-GUI

Der Visu-Editor liegt im Admin-GUI unter **Visu-Editor** in der Seitennavigation.
Mit ihm werden die Seiten der Visu 2.0 angelegt und gestaltet: normale Seiten,
Popups, Inkludeseiten und globale Inkludeseiten.

## Überblick und Zugang {#visu-editor}

Der Editor ist ein Admin-Bereich. Der Menüpunkt erscheint nur bei einem
angemeldeten Administrator, und die Adresse `/visu-editor` weist jeden anderen
zum Dashboard zurück. Das ist Absicht: die Visu selbst ist der
nutzerseitige Endpunkt (bei Bedarf ganz ohne Anmeldung), das Gestalten der
Seiten gehört in die Administration, wo die Berechtigungen ausgewertet werden.

Der Editor bearbeitet immer genau **eine** Seite. Die Adresse dorthin ist
teilbar:

```
/visu-editor/<Seiten-Id>
```

Ohne Seiten-Id steht der Bereich trotzdem offen: der Seitenbaum ist da, und der
Editor sagt, dass die Seitenauswahl fehlt.

Die Fläche gliedert sich in fünf Bereiche:

| Bereich | Wozu |
|---|---|
| Seitenbaum | Seiten und Ordner anlegen, auswählen, umordnen, verschieben, löschen |
| Canvas | Elemente anordnen, pixelgenau oder responsiv |
| Seiteneigenschaften | Name, Seitentyp, Popup-Parameter, Includes, Zugriff, Skin |
| Vorschau | die echte Visu mit dem aktuellen Entwurf |
| Autorenteil | Widget-Palette, Elemente der Seite, Bindung des ausgewählten Elements |

Jeder Bereich hat sein eigenes Hilfe-Zeichen. Ein Klick darauf öffnet genau den
Abschnitt dieser Hilfe, der dazu gehört.

## Seitenbaum {#visu-page-tree}

Der Seitenbaum zeigt die Hierarchie der Visu. Ein Abzeichen an jedem Eintrag
sagt, was er ist: **Ordner**, **Seite**, **Inkludeseite**, **Global** oder
**Popup**.

Was der Baum kann:

- **Seite anlegen** und **Ordner anlegen** legen einen neuen Knoten an. Ein
  Ordner ist nur Struktur; er trägt keinen Inhalt und keinen Seitentyp.
- **Nach oben** und **Nach unten** ändern die Reihenfolge unter demselben
  Elternknoten. Die Reihenfolge ist keine Anzeigefrage: bei globalen
  Inkludeseiten entscheidet sie über die Stapelung (siehe
  [Globale Inkludeseiten](/visu/seitentypen#visu-page-global-includes)).
- **Verschieben** hängt einen Knoten unter einen anderen Elternknoten oder auf
  die oberste Ebene. Der eigene Teilbaum steht dabei nicht zur Auswahl.
- **Löschen** fragt mit Namen nach. Das Löschen nimmt den ganzen Teilbaum mit.

Umbenannt wird eine Seite nicht im Baum, sondern über das Feld **Name** in den
Seiteneigenschaften. Es gibt bewusst nur einen Schreibweg für denselben Wert.

## Vorschau {#visu-editor-preview}

Die Vorschau ist **kein Nachbau**. Im Rahmen läuft die echte Visu, im
Vorschau-Modus, mit demselben Skin und derselben Darstellungskette, die auch der
Nutzer sieht. Der Entwurf reist als Nachricht in den Rahmen; gespeichert wird
dabei nichts.

Daraus folgt zweierlei:

- Was in der Vorschau steht, steht nach dem Speichern genauso in der Visu. Ein
  Element, das die Vorschau nicht zeigt, wird auch dem Nutzer nicht angezeigt.
- Datenpunkt-Werte in der Vorschau sind **echte Live-Werte** vom Server, keine
  Platzhalter.

Die Vorschau trägt die Sitzung des angemeldeten Administrators. Sie bekommt sie
ausschließlich über die Nachrichtenbrücke, nie über die Adresse: in der URL
des Rahmens steht kein Token, und es gibt keinen Abfrageteil, der eines
enthalten könnte.

Ausgeliefert wird die Vorschau vom Server selbst, unter

```
/visu-v2/preview
```

Dieselbe Auslieferung trägt unter `/visu-v2/` die Visu 2.0 insgesamt. Die
Visu 1 bleibt davon unberührt unter `/visu/` erreichbar.

Steht im Rahmen ein Hinweis statt einer Vorschau, antwortet unter der
Vorschau-Adresse keine Visu. Zwei Ursachen sind häufig:

1. Die Visu 2.0 ist nicht gebaut, es gibt also nichts auszuliefern.
2. Im Entwicklungsbetrieb laufen Admin-GUI und Visu auf getrennten Servern. Dann
   zeigt `VITE_VISU_PREVIEW_URL` auf den Vorschau-Pfad des Visu-Servers, und
   `VITE_PREVIEW_ALLOWED_ORIGINS` nennt die Herkunft der Admin-GUI. Beide
   Angaben gehören zusammen.

**In den veröffentlichten Paketen fehlt die Visu 2.0 noch.** Docker-Abbild,
LXC-Template und das Bündel von `obs-update` tragen `visu_v2_dist/` nur dann,
wenn es **vor** dem Paketbau erzeugt wurde. Die Bauwerkstücke der
Veröffentlichung tun das noch nicht: dort antwortet `/visu-v2` mit 404, und der
Vorschaukasten des Editors bleibt leer. Wer die Visu 2.0 samt Vorschau haben
will, baut das Paket selbst: `tools/build-local.sh` erzeugt das Bündel vor dem
Packen und sagt im Bauprotokoll, ob es im Ergebnis liegt.

Die Visu 1 unter `/visu/` ist davon nicht betroffen; sie ist in jedem Paket
unverändert enthalten.

## Skin je Seite {#visu-page-skin}

Der Skin bestimmt, wie eine Seite gezeichnet wird, und er entscheidet auch,
welcher [Layout-Modus](/visu/canvas#visu-layout-modes) überhaupt honoriert wird.
Der Editor zeigt je Skin an, was er rendert: ein seitenbesitzender Skin wertet
Koordinaten aus, ein listenartiger Skin nur die Reihenfolge.
