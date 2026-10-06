---
title: Adapter-Instanzen
---

# Adapter-Instanzen {#adapters}

Adapter binden externe Systeme (KNX, Modbus, MQTT, 1-Wire, Home Assistant, ioBroker,
SNMP, Zeitschaltuhr, Anwesenheitssimulation und weitere) als **Instanzen** an OBS an.
Jede Instanz hat einen Typ, eine eigene Konfiguration und beliebig viele Verknüpfungen
(Bindings) zu Objekten (DataPoints).

## Instanzliste {#adapters-list}

Jede Karte zeigt eine Adapter-Instanz mit:

- **Status-Punkt** — fasst den Verbindungszustand farblich zusammen:

  | Farbe | Bedeutung |
  |---|---|
  | grau | Instanz inaktiv/gestoppt |
  | grün | läuft und verbunden |
  | gelb, pulsierend | läuft, aber (noch) nicht verbunden |
  | gelb | Warnung (eingeschränkter Betrieb) |
  | rot | Fehler |

- **Typ-Badge** — der Adapter-Typ (z. B. KNX, MODBUS_TCP).
- **Status-Badge** — Textform des Status-Punkts (Verbunden / Läuft / Eingeschränkt /
  Inaktiv / Fehler).
- **Verknüpfungen** — Anzahl der Objekt-Bindings dieser Instanz.

Bei Warnung oder Fehler erscheint zusätzlich eine Detailmeldung mit der genauen Ursache.
Ein Klick auf den Pfeil rechts klappt die Instanz auf und zeigt Konfiguration und Aktionen
(siehe unten).

## Neue Instanz erstellen {#adapters-create}

„+ Neue Instanz" öffnet ein Formular: zuerst **Adapter-Typ** und **Name** wählen, danach
erscheint die typ-spezifische Konfigurationsmaske (z. B. Host/Port für KNX oder Modbus TCP,
Broker-Adresse für MQTT). Erst nach dem Erstellen lassen sich Verknüpfungen zu Objekten
anlegen.

## Instanz-Aktionen {#adapters-instance-actions}

Im aufgeklappten Zustand einer Instanz:

- **Verbindung testen** — prüft die aktuell eingegebene Konfiguration, ohne zu speichern.
- **Speichern** — übernimmt Änderungen und verbindet den Adapter neu.
- **Neu verbinden** — trennt und verbindet die bestehende Konfiguration neu, ohne sie zu
  ändern.
- **Importieren** (nur ioBroker) — übernimmt ioBroker-States als neue OBS-Objekte samt
  Verknüpfung.
- **Objekte verwalten** (nur Anwesenheitssimulation) — wählt simulierte Boolean-/
  Integer-Objekte aus und verwaltet deren Bindings.
- **Bindings migrieren** — verschiebt alle Verknüpfungen dieser Instanz auf eine andere
  Instanz desselben Adapter-Typs; am Ziel bereits vorhandene Verknüpfungen werden dabei
  übersprungen.
- **Instanz löschen** — löscht die Instanz unwiderruflich, inklusive aller ihrer
  Verknüpfungen.

„Aktiviert" schaltet die Instanz komplett aus, ohne sie zu löschen — eine deaktivierte
Instanz behält ihre Konfiguration und Bindings, verbindet sich aber nicht.

## Webhook: eingehender HTTP-Aufruf als Quelle {#adapters-webhook}

Viele Geräte können bei einem Ereignis nur **eine URL aufrufen** — ohne eigene Header, ohne
Body, ohne MQTT. Eine Türsprechstelle ruft beim Klingeln eine konfigurierte URL auf, ein
IP-Taster beim Tastendruck, eine Kamera bei Bewegung. Der Adapter-Typ **WEBHOOK** macht aus
so einem Aufruf einen Wert auf einem Objekt. Von dort wirkt er wie jede andere Quelle: ein
zusätzliches DEST-Binding (z. B. KNX) auf demselben Objekt schickt das Telegramm auf den Bus,
auf das Gong, Visu und Logik reagieren.

### Instanz einrichten

| Feld | Bedeutung |
|---|---|
| **Pfad-Präfix** | Pfad, unter dem die Instanz erreichbar ist. Standard `/hook`. Maximal drei Segmente; `api`, `assets`, `help`, `setup` und `visu` sind belegt. |
| **Erlaubte Netze (CIDR)** | Liste von Netzen oder Einzeladressen, die den Endpunkt erreichen dürfen. Einträge werden einzeln verwaltet (Zeile hinzufügen/entfernen). Leer = keine Einschränkung. |
| **X-Forwarded-For vertrauen** | Nur einschalten, wenn ein Reverse Proxy vorgeschaltet ist. Ohne Proxy könnte jeder Aufrufer eine erlaubte Absenderadresse vortäuschen. |
| **Ratenlimit** | Angenommene Aufrufe pro Minute und Absender-IP. Darüber antwortet der Endpunkt mit `429`. |

Zwei Instanzen können nicht dasselbe Präfix belegen; die zweite meldet einen Fehler und
bleibt getrennt.

### Verknüpfung anlegen

Eine Webhook-Verknüpfung entsteht wie jede andere: am Objekt unter **Verknüpfungen** die
Webhook-Instanz wählen. Die Richtung ist immer **Lesen (SOURCE)** — ein Webhook ist ein
Eingang.

| Feld | Bedeutung |
|---|---|
| **Slug** | Pfadsegment der Aufruf-URL, z. B. `haustuer-klingel`. Kleinbuchstaben, Ziffern, `-` und `_`; je Instanz eindeutig. |
| **Erlaubte HTTP-Methoden** | `GET`, `POST` oder beides. Geräte, die nur eine URL aufrufen können, benutzen `GET`. |
| **Wertquelle** | **Fester Wert** für Taster und Klingeln (`true`), oder **Wert aus der Anfrage**. |
| **Parameter-/Feldname** | Bei *Wert aus der Anfrage*: der Query-Parameter bei `GET` (`?value=1`), bzw. das gleichnamige Feld im JSON-Body bei `POST`. Standard `value`. |
| **Erlaubte Netze (CIDR)** | Zusätzliche Allowlist nur für diese Verknüpfung — z. B. die feste Adresse genau dieser Türsprechstelle. Leer = es gilt nur die Allowlist der Instanz. |
| **Entprellung (ms)** | Weitere Aufrufe innerhalb dieser Zeit werden mit `204` bestätigt, setzen den Wert aber nicht erneut. `0` = aus. |

### Zwei Ebenen für die Allowlist

Ein Aufruf muss **beide** Allowlists passieren: die der Instanz (Perimeter für
den ganzen Endpunkt) und die der Verknüpfung (nur dieses eine Gerät). Eine leere
Liste schränkt auf ihrer Ebene nicht ein. Damit kann eine Verknüpfung den
Perimeter der Instanz immer nur **enger** ziehen, nie weiter — sonst wäre der
Perimeter wirkungslos.

::: warning Vorsicht bei einem Reverse Proxy
Steht ein Reverse Proxy (nginx, Caddy) vor OBS, kommen alle Aufrufe mit dessen
Adresse an — bei einem Proxy auf demselben Host also als `127.0.0.1`. Dann
greift die Allowlist nicht mehr wie gedacht. In dem Fall **X-Forwarded-For
vertrauen** einschalten *und* sicherstellen, dass der Proxy diesen Header selbst
setzt und einen vom Client mitgeschickten überschreibt.
:::

Der Wert wird in den Datentyp des Objekts umgewandelt — `1`, `true`, `on` und `yes` ergeben
auf einem Boolean-Objekt `true`, `0`, `false`, `off` und `no` ergeben `false`. Passt der Wert
nicht zum Datentyp, antwortet der Endpunkt mit `400` und es wird nichts gesetzt. Formel und
Wertzuordnung aus dem Reiter *Transformation* gelten wie bei jeder anderen Quelle.

### Aufruf-URL und Token

Beim Anlegen erzeugt der Server **je Verknüpfung ein eigenes Token**. Nach dem Speichern zeigt
das Formular die fertige Aufruf-URL zum Kopieren — in zwei Varianten:

```
http://obs:8080/hook/haustuer-klingel?token=<geheimnis>
http://obs:8080/hook/haustuer-klingel/<geheimnis>
```

Die zweite Variante hilft bei Geräten, deren Konfigurationsfeld keine Query-Parameter
zulässt. Beide verhalten sich gleich:

| Antwort | Bedeutung |
|---|---|
| `204` | Wert übernommen (oder durch die Entprellung bewusst verworfen) |
| `400` | Wert fehlt oder passt nicht zum Datentyp des Objekts |
| `404` | Unbekannter Slug, falsches Token, nicht erlaubte Methode oder gesperrte Absenderadresse — bewusst nicht unterscheidbar |
| `429` | Ratenlimit der Instanz überschritten |

::: tip Die URL wird mit der Adresse gebaut, unter der die Admin-GUI gerade offen ist
Wer OBS über `http://localhost:8080` administriert, bekommt eine `localhost`-URL
zum Kopieren — und ein Aufruf von dort kommt als `127.0.0.1` an. Ist in der
Allowlist nur das LAN eingetragen (z. B. `10.38.0.0/16`), wird genau dieser
Testaufruf mit `404` abgewiesen, obwohl Slug und Token stimmen. Das Formular
weist darauf hin, sobald die Allowlist den gerade verwendeten Absender nicht
abdeckt; zum Testen entweder `127.0.0.1` ergänzen oder die GUI über die
LAN-Adresse öffnen.
:::

Unter der URL zeigt das Formular außerdem **Aufrufe**, **gesetzte Werte** und den **letzten
Aufruf** dieser Verknüpfung. Diese Zähler leben im laufenden Betrieb und beginnen nach einem
Neustart wieder bei null; die Werte selbst stehen wie immer im Monitor und in der Historie,
dort mit `WEBHOOK` als Quelle.

Abgewiesene Aufrufe erscheinen daneben mit **Grund und Absenderadresse** —
Ratenlimit, Adresse nicht in der Allowlist (Instanz oder Verknüpfung),
unbekannter Slug, falsches Token oder nicht erlaubte Methode. Weil die Antwort
nach außen bewusst ein nicht unterscheidbares `404` bleibt, ist diese Anzeige
der einzige Ort, an dem sich ein stiller Fehlschlag überhaupt erkennen lässt.
Die Zähler der Instanz stehen unter **Adapter → Instanz**, die einer einzelnen
Verknüpfung direkt unter deren Aufruf-URL.

**Token neu erzeugen** widerruft die bisherige URL sofort und gibt eine neue aus — z. B.
wenn ein Gerät ausgetauscht wird oder seine Konfiguration in falsche Hände geraten ist.
Andere Verknüpfungen und Integrationen bleiben davon unberührt.

### Warum ein Token je Verknüpfung und kein API-Key

Ein API-Key darf jedes Objekt schreiben. In einem Gerät außen am Haus, dessen Konfiguration
oft im Klartext liegt, wäre das ein echtes Risiko — zumal Tokens in Geräte- und Proxy-Logs
landen. Das Webhook-Token berechtigt dagegen **genau dieses eine Objekt mit genau dieser
Wertabbildung**: ein kompromittiertes Gerät kann nur klingeln.

Aus demselben Grund lassen sich Webhook-Verknüpfungen **nicht** auf Objekte der Steuerklasse
`central_plant` legen — dieselbe Grenze, die auch der anonyme Schreibweg der Visu zieht. Wird
ein Objekt nachträglich so eingestuft, lehnt der Endpunkt den Aufruf mit `403` ab.

Das Anlegen und Rotieren einer Verknüpfung bleibt dagegen eine normale Konfigurationsänderung:
sie verlangt Schreibrechte (Rolle *operator*) auf der Adapter-Instanz und ist nur mit einem
Benutzer-Login möglich, nicht mit einem API-Key.
