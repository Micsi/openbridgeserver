# Die Optik gehört zum Skin, nicht zur Marke

Die Marke OBS (Logo, DM Mono, `#0f6e56`) und die Optik einer Visu sind getrennte
Dinge: Was auf dem Bildschirm erscheint, bestimmt der Skin. Deshalb trägt jeder Skin
eigene Optik-Regeln, und unter ihm kann jedes Icon-Set eigene Bauregeln führen —
normativ ist das Icon-Set, nicht die Marke.

## Considered Options

Das BrandKit legt in seiner Icon-Domäne (dort ADR 0001) die Bauregeln ins Brand-Paket
und bestätigt einen Stil je Marke. Übernommen hätte das bedeutet: ein Icon-Stil für
alles, was OBS ausliefert, und die runde Kachelwelt des Skins `ionic` als
Markenentscheidung. Verworfen, weil die Marke selbst linear und fast scharfkantig ist
und mit der Optik eines Skins nichts zu tun hat — und weil verschiedene Skins
verschieden aussehen sollen.

## Consequences

`ionic` als mitgelieferter Standard-Skin läuft über das BrandKit von OBS. Jeder
weitere Skin entspricht dort einer eigenen Marke mit eigenem Paket; `icon` bleibt
darin eine Domäne wie bisher. Offen: Mehrere Icon-Sets innerhalb eines Skins brauchen
mehr als einen Gewinner je Domäne, und der Bestätigungsweg des BrandKits sieht genau
einen vor. Das muss gelöst sein, bevor ein Skin sein zweites Set bekommt.
