---
title: Visu-Editor
---

# Visu-Editor der Admin-GUI

Der Visu-Editor liegt im Admin-GUI unter **Visu-Editor** in der Seitennavigation.
Mit ihm werden die Seiten der Visu 2.0 angelegt und gestaltet: normale Seiten,
Popups, Inkludeseiten und globale Inkludeseiten.

## Überblick und Zugang {#visu-editor}

Der Editor ist ein Admin-Bereich. Der Menuepunkt erscheint nur bei einem
angemeldeten Administrator, und die Adresse `/visu-editor` weist jeden anderen
zum Dashboard zurueck. Das ist Absicht: die Visu selbst ist der
nutzerseitige Endpunkt (bei Bedarf ganz ohne Anmeldung), das Gestalten der
Seiten gehoert in die Administration, wo die Berechtigungen ausgewertet werden.

Der Editor bearbeitet immer genau **eine** Seite. Die Adresse dorthin ist
teilbar:

```
/visu-editor/<Seiten-Id>
```

Ohne Seiten-Id steht der Bereich trotzdem offen: der Seitenbaum ist da, und der
Editor sagt, dass die Seitenauswahl fehlt.

Die Flaeche gliedert sich in fuenf Bereiche:

| Bereich | Wozu |
|---|---|
| Seitenbaum | Seiten und Ordner anlegen, auswaehlen, umordnen, verschieben, loeschen |
| Canvas | Elemente anordnen, pixelgenau oder responsiv |
| Seiteneigenschaften | Name, Seitentyp, Popup-Parameter, Includes, Zugriff, Skin |
| Vorschau | die echte Visu mit dem aktuellen Entwurf |
| Autorenteil | Widget-Palette, Elemente der Seite, Bindung des ausgewaehlten Elements |

Jeder Bereich hat sein eigenes Hilfe-Zeichen. Ein Klick darauf oeffnet genau den
Abschnitt dieser Hilfe, der dazu gehoert.

## Seitenbaum {#visu-page-tree}

Der Seitenbaum zeigt die Hierarchie der Visu. Ein Abzeichen an jedem Eintrag
sagt, was er ist: **Ordner**, **Seite**, **Inkludeseite**, **Global** oder
**Popup**.

Was der Baum kann:

- **Seite anlegen** und **Ordner anlegen** legen einen neuen Knoten an. Ein
  Ordner ist nur Struktur; er traegt keinen Inhalt und keinen Seitentyp.
- **Nach oben** und **Nach unten** aendern die Reihenfolge unter demselben
  Elternknoten. Die Reihenfolge ist keine Anzeigefrage: bei globalen
  Inkludeseiten entscheidet sie ueber die Stapelung (siehe
  [Globale Inkludeseiten](/visu/seitentypen#visu-page-global-includes)).
- **Verschieben** haengt einen Knoten unter einen anderen Elternknoten oder auf
  die oberste Ebene. Der eigene Teilbaum steht dabei nicht zur Auswahl.
- **Loeschen** fragt mit Namen nach. Das Loeschen nimmt den ganzen Teilbaum mit.

Umbenannt wird eine Seite nicht im Baum, sondern ueber das Feld **Name** in den
Seiteneigenschaften. Es gibt bewusst nur einen Schreibweg fuer denselben Wert.

## Vorschau {#visu-editor-preview}

Die Vorschau ist **kein Nachbau**. Im Rahmen laeuft die echte Visu, im
Vorschau-Modus, mit demselben Skin und derselben Darstellungskette, die auch der
Nutzer sieht. Der Entwurf reist als Nachricht in den Rahmen; gespeichert wird
dabei nichts.

Daraus folgt zweierlei:

- Was in der Vorschau steht, steht nach dem Speichern genauso in der Visu. Ein
  Element, das die Vorschau nicht zeigt, wird auch dem Nutzer nicht angezeigt.
- Datenpunkt-Werte in der Vorschau sind **echte Live-Werte** vom Server, keine
  Platzhalter.

Die Vorschau traegt die Sitzung des angemeldeten Administrators. Sie bekommt sie
ausschliesslich ueber die Nachrichtenbruecke, nie ueber die Adresse: in der URL
des Rahmens steht kein Token, und es gibt keinen Abfrageteil, der eines
enthalten koennte.

Ausgeliefert wird die Vorschau vom Server selbst, unter

```
/visu-v2/preview
```

Dieselbe Auslieferung traegt unter `/visu-v2/` die Visu 2.0 insgesamt. Die
Visu 1 bleibt davon unberuehrt unter `/visu/` erreichbar.

Steht im Rahmen ein Hinweis statt einer Vorschau, antwortet unter der
Vorschau-Adresse keine Visu. Zwei Ursachen sind haeufig:

1. Die Visu 2.0 ist nicht gebaut, es gibt also nichts auszuliefern.
2. Im Entwicklungsbetrieb laufen Admin-GUI und Visu auf getrennten Servern. Dann
   zeigt `VITE_VISU_PREVIEW_URL` auf den Vorschau-Pfad des Visu-Servers, und
   `VITE_PREVIEW_ALLOWED_ORIGINS` nennt die Herkunft der Admin-GUI. Beide
   Angaben gehoeren zusammen.

## Skin je Seite {#visu-page-skin}

Der Skin bestimmt, wie eine Seite gezeichnet wird, und er entscheidet auch,
welcher [Layout-Modus](/visu/canvas#visu-layout-modes) ueberhaupt honoriert wird.
Der Editor zeigt je Skin an, was er rendert: ein seitenbesitzender Skin wertet
Koordinaten aus, ein listenartiger Skin nur die Reihenfolge.
