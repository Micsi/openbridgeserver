---
title: Seitentypen
---

# Seitentypen

Jede Seite der Visu hat einen Typ. Er entscheidet, wo sie erscheint, was sie
einbetten darf und wie sie gezeichnet wird. Gesetzt wird er in den
**Seiteneigenschaften** des Visu-Editors.

## Seitentypen {#visu-page-kinds}

Der Editor bietet vier Typen an:

| Typ | Was er bedeutet |
|---|---|
| **Normale Seite** | Eine Seite der Navigation. Sie bekommt die globalen Inkludeseiten dazu. |
| **Inkludeseite** | Eine gewoehnliche Seite, die von mindestens einer anderen Seite eingebettet wird. |
| **Globale Inkludeseite** | Wird automatisch in jede normale Seite eingebettet. |
| **Popup** | Liegt ueber der Seite, wird ueber einen Verweis geoeffnet und steht nicht in der Navigation. |

**Inkludeseite ist eine abgeleitete Rolle, keine Einstellung.** Eine Seite wird
zur Inkludeseite, sobald eine andere Seite sie in ihre Include-Liste aufnimmt,
und sie hoert wieder auf, eine zu sein, wenn der letzte Verweis verschwindet.
Deshalb laesst der Editor "Inkludeseite" auch nicht speichern: er sagt es
vorher, statt die Wahl still auf "Normale Seite" zurueckfallen zu lassen.

Der Typ steht auch als Abzeichen im Seitenbaum, und die Navigation der Visu
blendet globale Inkludeseiten und Popups aus. Bestandsseiten aus der Zeit vor
den Seitentypen sind normale Seiten; sie aendern sich nicht.

## Popups und ihre Parameter {#visu-page-popup}

Ein Popup ist eine eigene Seite. Es liegt nicht in der Navigation, sondern wird
aus einer anderen Seite heraus geoeffnet. Beliebig viele **verschiedene** Popups
duerfen gleichzeitig offen stehen; dasselbe Popup wird nicht zweimal geoeffnet.

Die Seiteneigenschaften kennen dafuer folgende Angaben:

| Parameter | Wirkung |
|---|---|
| **X**, **Y** | Position in Pixeln. Fehlt eine der beiden Angaben, wird das Popup zentriert. |
| **Breite**, **Hoehe** | Groesse in Pixeln. Ohne Angabe entscheidet der Skin. |
| **Automatisch schliessen (ms)** | Zeitspanne in Millisekunden. Danach schliesst das Popup von selbst. |
| **Exklusiv oeffnen** | Modal: solange das Popup offen ist, ist alles darunter nicht bedienbar. |
| **Animation** | Das Popup wird eingeblendet statt hart gesetzt. |
| **Schlagschatten** | Das Popup hebt sich mit Schatten von der Seite ab. |
| **Hintergrund abdunkeln** | Die Flaeche hinter dem Popup wird abgedunkelt. |

Zwei Regeln, die leicht ueberraschen:

- **Die Frist zum automatischen Schliessen wird beim erneuten Oeffnen nicht
  verlaengert.** Wer ein bereits offenes Popup noch einmal oeffnet, bekommt
  keine neue Zeitspanne; es schliesst zu der Frist, die beim ersten Oeffnen
  begonnen hat.
- **Ein Popup bekommt keine globalen Inkludeseiten.** Es ist ein Ausschnitt ueber
  der Seite, keine Seite der Navigation, und es darf auch selbst nichts
  inkludieren.

## Individuelle Inkludeseiten {#visu-page-includes}

Eine normale Seite kann andere Seiten einbetten. Die Auswahl steht in den
Seiteneigenschaften als geordnete Liste; die Reihenfolge der Liste ist die
Reihenfolge der Darstellung.

Die Regeln dazu:

- Ziel darf eine **normale Seite** oder eine **globale Inkludeseite** sein, nie
  ein Popup.
- Eine Seite kann sich nicht selbst einbetten.
- Ringschluesse sind verboten: A bettet B ein, B bettet A ein, wird abgelehnt.
  Das gilt auch ueber mehrere Stufen.
- Ein Ziel steht in der Liste hoechstens einmal. Doppelte Eintraege werden still
  entfernt, das erste Vorkommen behaelt seinen Platz.

Eine Aenderung an der eingebetteten Seite wirkt sofort in **allen** Seiten, die
sie einbetten. Es gibt nichts erneut zu importieren und nichts nachzuziehen: die
Seiten verweisen auf dieselbe Quelle, sie kopieren sie nicht.

Ist eine eingebettete Quelle fuer den Betrachter nicht lesbar, wird die Stelle
verdeckt, ohne Fehlermeldung. Ist die Quelle nur lesbar, aber nicht bedienbar,
erscheinen ihre Bedienelemente gesperrt. Verlangt sie eine PIN, wird die Stelle
als gesperrt gekennzeichnet, statt still zu verschwinden.

## Globale Inkludeseiten {#visu-page-global-includes}

Eine globale Inkludeseite wird ohne weiteres Zutun in **jede normale Seite**
eingebettet. Typischer Einsatz: eine Kopfzeile, eine Statusleiste oder eine
Navigationsspalte, die auf allen Seiten stehen soll.

- **Mehrere globale Inkludeseiten werden gestapelt**, aufsteigend nach der
  Reihenfolge im Seitenbaum: die kleinste Reihenfolge liegt zuunterst. Die
  Reihenfolge ist damit im Editor sichtbar und vom Autor steuerbar.
- **Eine globale Inkludeseite kann selbst nichts einbetten.** Es gibt genau eine
  Ebene. Der Versuch wird beim Speichern abgelehnt.
- **Wird eine globale Inkludeseite direkt aufgerufen**, zeigt sie die anderen
  globalen Inkludeseiten nicht. Sie steht dann fuer sich.
- **In Popups kommen globale Inkludeseiten nicht vor.**

Eine einzelne normale Seite kann sich davon ausnehmen: der Schalter
**Globale Inkludeseiten ignorieren** in den Seiteneigenschaften laesst genau
diese Seite ohne die globalen Ebenen.

## Zugriff und Zielgruppe {#visu-page-access}

Der Zugriff wird an derselben Stelle gesetzt wie der Seitentyp. Vier Stufen
stehen zur Wahl:

| Stufe | Wer sieht die Seite |
|---|---|
| **Oeffentlich (public)** | Jeder, auch ohne Anmeldung. |
| **Nur lesen (readonly)** | Jeder, aber Bedienelemente sind gesperrt. |
| **PIN-geschuetzt (protected)** | Wer die PIN dieser Seite eingibt. |
| **Nur Zielgruppe (user)** | Nur die ausgewaehlten Benutzer. |

Die zusaetzlichen Felder erscheinen genau dort, wo sie gelten: die **PIN** nur
bei `protected`, die **Zielgruppe** nur bei `user`. Der Editor faengt verbotene
Kombinationen ab, bevor gespeichert wird.

**Vom Elternknoten erben** ist die Vorgabe. Eine Seite ohne eigene Stufe
uebernimmt die des Elternknotens; erst wenn das Erben abgeschaltet ist, gilt die
hier gewaehlte Stufe.

Verdeckung wirkt in der Navigation: eine Seite, die der Betrachter nicht sehen
darf, taucht im Baum gar nicht erst auf.
