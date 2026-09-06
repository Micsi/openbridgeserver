"""Ausliefer-Route der V2-Visu und ihres Vorschau-Modus (M5 Teil D, #174).

Der V2-Editor lebt in der Admin-GUI und bettet die *echte* Visu als Vorschau ein
(`CONTRIBUTING-visu-m5.md` §2.4). Damit das kein Selbstbezug wird, muss der
Server `apps/visu` unter einem eigenen Praefix ausliefern. Bis Teil D fiel
`/visu-v2/preview` in den SPA-Rueckfall und lieferte `gui_dist/index.html` - im
Vorschaukasten stand die Admin-Oberflaeche selbst.

Diese Tests haengen an keiner Datenbank und an keinem Broker: `create_app()` liest
die `*_dist`-Verzeichnisse beim Bau der App, und die Routen haben keine
Lifespan-Abhaengigkeit. Sie liegen deshalb bewusst in `tests/unit` und laufen im
Pflicht-Gate mit.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

# Erkennungszeichen der drei ausgelieferten Buendel. Sie muessen sich
# unterscheiden, sonst koennte kein Test belegen, dass die richtige Seite kam.
_V2_MARKER = "<!-- visu-v2 index -->"
_V1_MARKER = "<!-- visu-v1 index -->"
_GUI_MARKER = "<!-- admin gui index -->"


def _test_settings(tmp_path: Path):
    from obs.config import (
        DatabaseSettings,
        MosquittoSettings,
        MqttSettings,
        SecuritySettings,
        Settings,
    )

    return Settings(
        database=DatabaseSettings(path=str(tmp_path / "test.db")),
        mqtt=MqttSettings(host="localhost", port=11883, username=None, password=None),
        security=SecuritySettings(
            jwt_secret="test-secret-32-chars-xxxxxxxxxxxx",
            jwt_expire_minutes=60,
            url_target_allowlist_path=str(tmp_path / "allowlist.yaml"),
        ),
        mosquitto=MosquittoSettings(
            passwd_file=str(tmp_path / "passwd"),
            reload_pid=None,
            reload_command=None,
            service_username="obs",
            service_password="test",
        ),
    )


@contextmanager
def _dist_tree(name: str, files: dict[str, bytes]) -> Iterator[Path]:
    """Legt ein `*_dist`-Verzeichnis im Projektwurzelverzeichnis an und raeumt es
    restlos wieder ab - auch die Zwischenverzeichnisse und auch bei einem Fehler.

    Das Verzeichnis MUSS an der echten Stelle liegen: `create_app()` leitet die
    Pfade aus `obs/main.py` ab, ein `tmp_path` wuerde nie gelesen.

    Ein SCHON GEBAUTES Buendel wird dafuer beiseitegelegt und danach
    zurueckgelegt. Ohne das haengen diese Tests daran, ob jemand vorher
    `pnpm build` laufen liess: mit gebautem `visu_v2_dist/` saehen sie das echte
    `index.html` statt ihrer Marke, und die Faelle „nicht gebaut" waeren gar
    nicht mehr herstellbar (gemessen: 2 Fehlschlaege, 22 Fehler).
    """
    root = _PROJECT_ROOT / name
    stash = _PROJECT_ROOT / f"{name}.pytest-stash"
    assert not stash.exists(), f"{stash.name} liegt noch da - Rest eines abgebrochenen Laufs?"
    beiseite = root.exists()
    if beiseite:
        root.rename(stash)
    created: list[Path] = []
    try:
        for rel, content in files.items():
            target = root / rel
            for parent in reversed(target.parents):
                if parent == _PROJECT_ROOT or _PROJECT_ROOT not in parent.parents:
                    continue
                if not parent.exists():
                    parent.mkdir()
                    created.append(parent)
            target.write_bytes(content)
            created.append(target)
        yield root
    finally:
        for path in reversed(created):
            if path.is_dir():
                path.rmdir()
            else:
                path.unlink(missing_ok=True)
        if beiseite:
            stash.rename(root)


_V2_FILES = {
    "index.html": f"<html><body>{_V2_MARKER}</body></html>".encode(),
    "assets/index-abc123.js": b"export const visuV2 = true;\n",
    "favicon.svg": b'<svg xmlns="http://www.w3.org/2000/svg"/>',
}
_V1_FILES = {
    "index.html": f"<html><body>{_V1_MARKER}</body></html>".encode(),
    "assets/v1-def456.js": b"export const visuV1 = true;\n",
    "favicon.svg": b'<svg xmlns="http://www.w3.org/2000/svg"/>',
    "manifest.webmanifest": b'{"name":"OBS Visu"}',
    "apple-touch-icon.png": b"\x89PNG\r\n\x1a\n" + b"\x00" * 8,
}
_GUI_FILES = {
    "index.html": f"<html><body>{_GUI_MARKER}</body></html>".encode(),
    "assets/gui-999.js": b"export const gui = true;\n",
}


@contextmanager
def _app_with(dists: dict[str, dict[str, bytes] | None], tmp_path: Path):
    """App mit genau diesen Buendeln. `None` heisst „dieses Verzeichnis gibt es
    waehrend des Tests NICHT" - es wird beiseitegelegt und danach zurueckgelegt."""
    from obs.config import get_settings, override_settings
    from obs.main import create_app

    saved = get_settings()
    override_settings(_test_settings(tmp_path))
    stack: list = []
    try:
        for name, files in dists.items():
            ctx = _dist_tree(name, files or {})
            ctx.__enter__()
            stack.append(ctx)
        yield create_app()
    finally:
        for ctx in reversed(stack):
            ctx.__exit__(None, None, None)
        override_settings(saved)


@pytest_asyncio.fixture
async def full_stack_client(tmp_path):
    """Alle drei Buendel gleichzeitig - die Lage im ausgelieferten Server.

    Nur so ist die Aussage „V1 bleibt unveraendert erreichbar" (R17) ueberhaupt
    pruefbar: sie gilt gerade dann, wenn V2 daneben steht.
    """
    with _app_with(
        {"gui_dist": _GUI_FILES, "frontend_dist": _V1_FILES, "visu_v2_dist": _V2_FILES},
        tmp_path,
    ) as app:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield client


@pytest_asyncio.fixture
async def no_v2_client(tmp_path):
    """Admin-GUI da, V2-Buendel nicht gebaut.

    Das leere `visu_v2_dist`-Verzeichnis wird ausdruecklich mitgefuehrt: ein
    schon gebautes Buendel liegt sonst noch da, die Route ist registriert, und
    der Fall „nicht gebaut" waere gar nicht hergestellt.
    """
    with _app_with({"gui_dist": _GUI_FILES, "visu_v2_dist": None}, tmp_path) as app:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield client


# ── ausgeliefert ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_preview_serves_the_v2_bundle(full_stack_client):
    resp = await full_stack_client.get("/visu-v2/preview")
    assert resp.status_code == 200
    assert _V2_MARKER in resp.text


@pytest.mark.asyncio
async def test_preview_is_not_the_admin_gui_shell(full_stack_client):
    """Der eigentliche Blocker von E3: der Vorschaukasten zeigte die Admin-GUI."""
    resp = await full_stack_client.get("/visu-v2/preview")
    assert _GUI_MARKER not in resp.text
    assert _V1_MARKER not in resp.text


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/visu-v2", "/visu-v2/", "/visu-v2/edomi", "/visu-v2/a/b/c"])
async def test_v2_spa_paths_serve_the_index(full_stack_client, path):
    """History-Mode: jeder Pfad unter dem Praefix ist die eine SPA - auch der
    nackte Praefix ohne Schraegstrich, der sonst in den Admin-Rueckfall faellt."""
    resp = await full_stack_client.get(path)
    assert resp.status_code == 200
    assert _V2_MARKER in resp.text


@pytest.mark.asyncio
async def test_v2_assets_are_served_as_files(full_stack_client):
    """Ohne eigenen Asset-Mount lieferte der SPA-Rueckfall `index.html` mit
    `text/html` fuer jede `.js` - der Browser bricht dann mit einem
    MIME-Type-Fehler ab, und die Vorschau bliebe weiss."""
    resp = await full_stack_client.get("/visu-v2/assets/index-abc123.js")
    assert resp.status_code == 200
    assert "javascript" in resp.headers.get("content-type", "")
    assert "visuV2" in resp.text


@pytest.mark.asyncio
async def test_v2_unknown_asset_is_404_not_the_index(full_stack_client):
    """Ein fehlendes Asset muss als Fehler sichtbar werden statt als HTML-Seite."""
    resp = await full_stack_client.get("/visu-v2/assets/gibt-es-nicht.js")
    assert resp.status_code == 404
    assert _V2_MARKER not in resp.text


@pytest.mark.asyncio
async def test_v2_favicon_served(full_stack_client):
    resp = await full_stack_client.get("/visu-v2/favicon.svg")
    assert resp.status_code == 200
    assert "svg" in resp.headers.get("content-type", "")


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/visu-v2", "/visu-v2/preview"])
async def test_v2_without_bundle_is_json_404_not_the_admin_shell(no_v2_client, path):
    """Ohne gebautes Buendel darf der Vorschaukasten NICHT die Admin-GUI zeigen -
    genau dieser stille Rueckfall war der Fehler vor Teil D."""
    resp = await no_v2_client.get(path)
    assert resp.status_code == 404
    assert _GUI_MARKER not in resp.text


@pytest_asyncio.fixture
async def half_built_v2_client(tmp_path):
    """Ein `visu_v2_dist/` OHNE `index.html` - ein abgebrochener oder halb
    kopierter Build. Die Route steht dann, hat aber nichts auszuliefern."""
    with _app_with(
        {"gui_dist": _GUI_FILES, "visu_v2_dist": {"assets/index-abc123.js": b"x\n"}},
        tmp_path,
    ) as app:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield client


@pytest.mark.asyncio
async def test_v2_without_index_says_so_instead_of_showing_the_admin_gui(half_built_v2_client):
    resp = await half_built_v2_client.get("/visu-v2/preview")
    assert resp.status_code == 404
    assert _GUI_MARKER not in resp.text
    assert resp.json()["detail"] == "Visu 2 nicht gebaut"


# ── V1 unveraendert (R17) ────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/visu/", "/visu/rooms", "/visu/anything/deep"])
async def test_v1_spa_still_served_next_to_v2(full_stack_client, path):
    resp = await full_stack_client.get(path)
    assert resp.status_code == 200
    assert _V1_MARKER in resp.text
    assert _V2_MARKER not in resp.text


@pytest.mark.asyncio
async def test_v1_assets_still_served_next_to_v2(full_stack_client):
    resp = await full_stack_client.get("/visu/assets/v1-def456.js")
    assert resp.status_code == 200
    assert "visuV1" in resp.text


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("path", "needle"),
    [
        ("/visu/favicon.svg", "svg"),
        ("/visu/manifest.webmanifest", "json"),
        ("/visu/apple-touch-icon.png", "image/png"),
    ],
)
async def test_v1_named_files_still_served_next_to_v2(full_stack_client, path, needle):
    resp = await full_stack_client.get(path)
    assert resp.status_code == 200
    assert needle in resp.headers.get("content-type", "")


@pytest.mark.asyncio
async def test_admin_gui_fallback_untouched(full_stack_client):
    """Der Rueckfall bleibt der Rueckfall: eine unbekannte Adresse ausserhalb der
    drei Praefixe ist weiterhin die Admin-SPA."""
    resp = await full_stack_client.get("/irgendein-admin-pfad")
    assert resp.status_code == 200
    assert _GUI_MARKER in resp.text


# ── kein Token in URL, Query oder Log ────────────────────────────────────────


@pytest.mark.asyncio
async def test_preview_ignores_query_parameters(full_stack_client):
    """Die Vorschau traegt die Admin-Sitzung per `postMessage`, nie ueber die
    Adresse. Die Route darf einen Query also weder brauchen noch beachten: mit
    und ohne kommt byteweise dasselbe Dokument."""
    ohne = await full_stack_client.get("/visu-v2/preview")
    mit = await full_stack_client.get("/visu-v2/preview?token=geheim-abc&session=xyz")
    assert mit.status_code == 200
    assert mit.content == ohne.content


@pytest.mark.asyncio
async def test_preview_never_echoes_or_logs_a_token(full_stack_client, caplog):
    """Weder der Rumpf noch ein Header noch eine Log-Zeile der Anwendung darf das
    Geheimnis aus der Adresse weitertragen.

    GRENZE, ausdruecklich: der ZUGRIFFS-Log des ASGI-Servers (uvicorn) schreibt
    jede Adresse samt Query, und ebenso der HTTP-Client dieses Tests; daran
    aendert keine Route etwas. Die Zusage
    „kein Token im Log" wird deshalb an der Quelle gehalten, nicht hier: die
    Vorschau bekommt die Sitzung per `postMessage`, und die iframe-Adresse traegt
    nie einen Query (belegt in `gui/tests/components/visu/VisuPreviewFrame.spec.js`,
    „`src` enthaelt weder das Token noch ein `?`"). Was dieser Test dazu beitraegt:
    die Route selbst macht aus einem Query nichts - sie schreibt ihn weder in die
    Antwort noch in ein eigenes Protokoll.
    """
    geheim = "token-nur-fuer-diesen-test-9f3a"
    with caplog.at_level(logging.DEBUG, logger="obs"):
        resp = await full_stack_client.get(f"/visu-v2/preview?token={geheim}")
    assert geheim not in resp.text
    assert all(geheim not in v for v in resp.headers.values())
    # Nur die Logger DIESER Anwendung. `caplog.text` traegt alles, was den
    # Wurzel-Logger erreicht - im Gesamtlauf auch die Zugriffszeile des
    # HTTP-Clients, mit der die Route nichts zu tun hat (gemessen: allein gruen,
    # im Gesamtlauf rot).
    eigene = [r.getMessage() for r in caplog.records if r.name.split(".")[0] == "obs"]
    assert all(geheim not in zeile for zeile in eigene)


@pytest.mark.asyncio
async def test_preview_sets_no_cookie(full_stack_client):
    """Eine Vorschau, die selbst eine Sitzung setzt, waere ein zweiter
    Anmeldeweg neben dem Admin-Login."""
    resp = await full_stack_client.get("/visu-v2/preview")
    assert "set-cookie" not in {k.lower() for k in resp.headers}


@pytest.mark.asyncio
async def test_preview_shell_is_the_same_with_and_without_credentials(full_stack_client):
    """Die Ausliefer-Route gibt nur die Huelle heraus und entscheidet nichts:
    mit Anmeldekopf kommt exakt dasselbe wie ohne. Alles Inhaltliche haengt an
    der API, die ihre eigene Pruefung behaelt."""
    anonym = await full_stack_client.get("/visu-v2/preview")
    mit_kopf = await full_stack_client.get("/visu-v2/preview", headers={"Authorization": "Bearer nicht-echt"})
    assert mit_kopf.content == anonym.content


@pytest.mark.asyncio
async def test_preview_shell_carries_no_page_or_datapoint_data(full_stack_client):
    """Die Huelle ist statisch. Sie enthaelt keine Seiten-, Datenpunkt- oder
    Nutzerdaten - ein Nicht-Admin, der die Adresse errrraet, sieht nichts, was
    die API ihm nicht ohnehin gaebe."""
    resp = await full_stack_client.get("/visu-v2/preview")
    body = resp.text.lower()
    for verraeter in ("datapoint", "page_config", "username", "access_token"):
        assert verraeter not in body
