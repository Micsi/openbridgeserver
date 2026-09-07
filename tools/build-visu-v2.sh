#!/usr/bin/env bash
# Baut die V2-Visu (`apps/visu`) nach `visu_v2_dist/`.
#
# WOFUER: `visu_v2_dist/` ist das Artefakt, das der Server unter `/visu-v2/`
# ausliefert (`obs/main.py`) — und damit die Vorschau `/visu-v2/preview`, die der
# Visu-Editor der Admin-GUI einbettet (CONTRIBUTING-visu-m5.md §2.4). Ohne dieses
# Verzeichnis antwortet `/visu-v2` mit 404 und der Editor hat keine Vorschau.
#
# WARUM ALS EIGENER SCHRITT UND NICHT IM PACKER: `apps/visu/package.json` haengt
# ueber drei `link:`-Abhaengigkeiten an einem Repo AUSSERHALB dieses Baums
# (`obs-visu-skins`, die drei Skins edomi/ionic/terminal). Docker- und LXC-Packer
# bauen die Frontends im Abbild bzw. im Builder-Container; dort gibt es diese
# Pfade nicht, ein `pnpm install` fuer `apps/visu` scheitert also zwangslaeufig.
# Deshalb wird die V2-Visu HIER, im Quell-Checkout, gebaut und den Packern als
# fertiges Artefakt gereicht: `tools/build-local.sh` ruft dieses Skript vor jedem
# Paketbau auf, `Dockerfile` und `tools/_lxc-inner.sh` uebernehmen das Ergebnis.
#
# Die Werkstuecke unter `.github/workflows/` (release, nightly-docker,
# lxc-template) holen sich `obs-visu-skins` per eigenem Checkout, stellen die
# `link:`-Pfade wieder her und rufen dieses Skript vor dem Verpacken auf
# (Micsi/openbridgeserver#191). Schlaegt es dort fehl, faellt der Lauf hart rot
# aus: ein Paket ohne `visu_v2_dist/` soll gar nicht erst entstehen.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
DIST="${PROJECT_ROOT}/visu_v2_dist"

cd "$PROJECT_ROOT"

if ! command -v pnpm > /dev/null 2>&1; then
    echo "error: pnpm nicht gefunden — die V2-Visu ist ein pnpm-Workspace-Paket." >&2
    exit 1
fi

# Die drei Skin-Pakete VOR dem Install pruefen: `pnpm install` scheitert an einem
# fehlenden `link:`-Ziel mit einer Meldung, die die Ursache nicht nennt.
fehlend=()
while IFS= read -r pfad; do
    [[ -d "$pfad" ]] || fehlend+=("$pfad")
done < <(sed -n 's/.*"link:\(.*\)".*/\1/p' apps/visu/package.json)

if [[ ${#fehlend[@]} -gt 0 ]]; then
    echo "error: die V2-Visu laesst sich hier nicht bauen — diese Skin-Pakete fehlen:" >&2
    printf '       %s\n' "${fehlend[@]}" >&2
    echo "       Sie liegen in einem eigenen Repo (obs-visu-skins), das neben diesem" >&2
    echo "       Checkout ausgecheckt sein muss. Ohne sie bleibt visu_v2_dist/ leer," >&2
    echo "       und im gebauten Paket antwortet /visu-v2 mit 404." >&2
    exit 1
fi

echo "==> V2-Visu bauen (apps/visu -> visu_v2_dist/) ..."
pnpm install --frozen-lockfile
pnpm --filter @obs/visu-app build

if [[ ! -f "$DIST/index.html" ]]; then
    echo "error: der Bau lief durch, aber $DIST/index.html fehlt." >&2
    exit 1
fi

echo "==> visu_v2_dist/ steht bereit ($(find "$DIST" -type f | wc -l | tr -d ' ') Dateien)."
