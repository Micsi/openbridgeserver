"""open bridge server — Open-Source Multiprotocol Server for Building Automation."""

from pathlib import Path as _Path

try:
    __version__ = (_Path(__file__).parent / "version").read_text().strip()
except OSError:
    __version__ = "dev-version"
