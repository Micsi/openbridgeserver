"""Test-time variants of the demo .knxproj in every ETS group address style (#1296).

The demo project in ``tools/`` is three-level and contains group addresses only.
These helpers derive, at test time and without checked-in binaries:

- a **two-level** project: ``GroupAddressStyle="TwoLevel"`` *and* no middle-group
  ranges — the group addresses of each middle range move up into its main range,
  the way ETS lays out a two-level project;
- a **free** project: ``GroupAddressStyle="Free"``; free style allows arbitrary
  nested ranges, so the existing range nesting stays as it is;
- in every variant one device (PA ``1.1.5``) whose two communication objects link
  group addresses, and one function in the building that references a third one.

Group addresses are stored as raw numbers in ETS XML, so all variants carry the
same addresses; only the style (and with it xknxproject's formatting) differs.
"""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from xml.etree import ElementTree

DEMO_KNXPROJ = Path(__file__).parent.parent / "tools" / "Demo-Test-Projekt-2026-04-06-17-18.knxproj"

STYLES = ("ThreeLevel", "TwoLevel", "Free")

DEVICE_PA = "1.1.5"
# Raw addresses linked below, with their internal (three-level) notation.
CO_SWITCH_RAW = 2305  # 1/1/1  "Licht EG Schalten"
CO_STATUS_RAW = 2306  # 1/1/2  "Licht OG Schalten"
FUNCTION_RAW = 2307  # 1/1/3  "Licht Keller Schalten"
STATE_RAW = 2308  # 1/1/4  "Licht Garten Schalten", linked by nothing
INTERNAL = {CO_SWITCH_RAW: "1/1/1", CO_STATUS_RAW: "1/1/2", FUNCTION_RAW: "1/1/3", STATE_RAW: "1/1/4"}
NOTATION = {
    "ThreeLevel": dict(INTERNAL),
    "TwoLevel": {CO_SWITCH_RAW: "1/257", CO_STATUS_RAW: "1/258", FUNCTION_RAW: "1/259", STATE_RAW: "1/260"},
    "Free": {raw: str(raw) for raw in INTERNAL},
}

_NS = "http://knx.org/xml/project/23"
_PROJECT = "P-065E"


def _q(tag: str) -> str:
    return f"{{{_NS}}}{tag}"


def _ga_id(root: ElementTree.Element, raw: int) -> str:
    for ga in root.iter(_q("GroupAddress")):
        if ga.get("Address") == str(raw):
            return ga.get("Id", "")
    raise LookupError(raw)


def _flatten_middle_ranges(root: ElementTree.Element) -> None:
    """Turn main/middle/address into main/address, as in a two-level ETS project."""
    ranges = root.find(f".//{_q('GroupAddresses')}/{_q('GroupRanges')}")
    for main_range in ranges.findall(_q("GroupRange")):
        for middle_range in main_range.findall(_q("GroupRange")):
            main_range.remove(middle_range)
            main_range.extend(middle_range.findall(_q("GroupAddress")))


def _add_device_and_function(root: ElementTree.Element) -> None:
    switch_id, status_id, function_ga_id = (_ga_id(root, raw) for raw in (CO_SWITCH_RAW, CO_STATUS_RAW, FUNCTION_RAW))
    segment = root.find(f".//{_q('Line')}[@Id='{_PROJECT}-0_L-3']/{_q('Segment')}")
    device = ElementTree.SubElement(
        segment,
        _q("DeviceInstance"),
        Id=f"{_PROJECT}-0_DI-1",
        Address="5",
        Name="Testaktor",
        ProductRefId="M-0083_H-1-1_P-1",
        Hardware2ProgramRefId="M-0083_H-1-1_HP-1",
        Puid="900",
    )
    refs = ElementTree.SubElement(device, _q("ComObjectInstanceRefs"))
    # ETS 5.7+ links group addresses by their project-local id ("0_GA-1").
    for number, (text, ga_id) in enumerate((("Schalten", switch_id), ("Status", status_id)), start=1):
        ElementTree.SubElement(
            refs,
            _q("ComObjectInstanceRef"),
            RefId=f"O-{number}_R-{number}",
            Text=text,
            DatapointType="DPST-1-1",
            Links=ga_id.split("_", 1)[1],
        )

    building = root.find(f".//{_q('Locations')}/{_q('Space')}")
    function = ElementTree.SubElement(building, _q("Function"), Id=f"{_PROJECT}-0_F-1", Name="Licht Keller", Type="SwitchableLight", Puid="901")
    ElementTree.SubElement(
        function,
        _q("GroupAddressRef"),
        Id=f"{_PROJECT}-0_F-1_GR-1",
        RefId=function_ga_id,
        Name="Schalten",
        Role="SwitchOnOff",
        Puid="902",
    )
    ElementTree.SubElement(building, _q("DeviceInstanceRef"), RefId=f"{_PROJECT}-0_DI-1")


def _add_device(root: ElementTree.Element, address: int, comm_objects: list[list[str]]) -> None:
    """Device ``1.1.<address>`` with one communication object per list of group address ids."""
    segment = root.find(f".//{_q('Line')}[@Id='{_PROJECT}-0_L-3']/{_q('Segment')}")
    device = ElementTree.SubElement(
        segment,
        _q("DeviceInstance"),
        Id=f"{_PROJECT}-0_DI-{100 + address}",
        Address=str(address),
        Name=f"Testgeraet {address}",
        ProductRefId="M-0083_H-1-1_P-1",
        Hardware2ProgramRefId="M-0083_H-1-1_HP-1",
        Puid=str(800 + address),
    )
    refs = ElementTree.SubElement(device, _q("ComObjectInstanceRefs"))
    for number, ga_ids in enumerate(comm_objects, start=1):
        ElementTree.SubElement(
            refs,
            _q("ComObjectInstanceRef"),
            RefId=f"O-{number}_R-{number}",
            Text=f"Objekt {number}",
            DatapointType="DPST-1-1",
            Links=" ".join(ga_id.split("_", 1)[1] for ga_id in ga_ids),
        )


def knxproj_in_style(style: str) -> bytes:
    """Return the demo project as .knxproj bytes in ``style``, with device and function."""
    if style not in STYLES:
        raise ValueError(style)
    ElementTree.register_namespace("", _NS)
    ElementTree.register_namespace("xsi", "http://www.w3.org/2001/XMLSchema-instance")
    ElementTree.register_namespace("xsd", "http://www.w3.org/2001/XMLSchema")
    out = io.BytesIO()
    with zipfile.ZipFile(DEMO_KNXPROJ) as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            data = zin.read(info.filename)
            if info.filename == f"{_PROJECT}/project.xml":
                data = data.replace(b'GroupAddressStyle="ThreeLevel"', f'GroupAddressStyle="{style}"'.encode())
            elif info.filename == f"{_PROJECT}/0.xml":
                root = ElementTree.fromstring(data)
                if style == "TwoLevel":
                    _flatten_middle_ranges(root)
                _add_device_and_function(root)
                data = ElementTree.tostring(root, encoding="utf-8", xml_declaration=True)
            zout.writestr(info, data)
    return out.getvalue()


def knxproj_with_datapoint_types(datapoint_types: dict[int, str | None]) -> bytes:
    """Return the three-level demo project with the ``DatapointType`` of some group addresses replaced (#1260).

    ``datapoint_types`` maps a raw address to its new ETS value: ``"DPT-14"`` (main type only),
    ``"DPST-14-56"`` (with subtype) or ``None`` (no datapoint type at all).
    """
    ElementTree.register_namespace("", _NS)
    ElementTree.register_namespace("xsi", "http://www.w3.org/2001/XMLSchema-instance")
    ElementTree.register_namespace("xsd", "http://www.w3.org/2001/XMLSchema")
    out = io.BytesIO()
    with zipfile.ZipFile(DEMO_KNXPROJ) as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            data = zin.read(info.filename)
            if info.filename == f"{_PROJECT}/0.xml":
                root = ElementTree.fromstring(data)
                for ga in root.iter(_q("GroupAddress")):
                    raw = int(ga.get("Address", "-1"))
                    if raw not in datapoint_types:
                        continue
                    if datapoint_types[raw] is None:
                        ga.attrib.pop("DatapointType", None)
                    else:
                        ga.set("DatapointType", datapoint_types[raw])
                data = ElementTree.tostring(root, encoding="utf-8", xml_declaration=True)
            zout.writestr(info, data)
    return out.getvalue()


def knxproj_with_extra_group_addresses(extra: dict[int, str], devices: dict[int, list[list[int]]] | None = None) -> bytes:
    """Return the three-level demo project plus group addresses the demo does not use (#1266).

    ``extra`` maps a raw address to its ETS name; each goes into the middle range
    that contains it. Addresses outside the demo's 500 keep a test independent of
    other imports of the demo into the same database.

    ``devices`` adds devices on line 1.1: device address → one list of raw addresses
    per communication object, which links them (the demo itself has no devices).
    """
    ElementTree.register_namespace("", _NS)
    ElementTree.register_namespace("xsi", "http://www.w3.org/2001/XMLSchema-instance")
    ElementTree.register_namespace("xsd", "http://www.w3.org/2001/XMLSchema")
    out = io.BytesIO()
    with zipfile.ZipFile(DEMO_KNXPROJ) as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            data = zin.read(info.filename)
            if info.filename == f"{_PROJECT}/0.xml":
                root = ElementTree.fromstring(data)
                used = {int(ga.get("Address", "-1")) for ga in root.iter(_q("GroupAddress"))}
                for number, (raw, name) in enumerate(sorted(extra.items()), start=1):
                    if raw in used:
                        raise ValueError(f"address {raw} is used by the demo project")
                    [middle] = [
                        r
                        for r in root.iter(_q("GroupRange"))
                        if not r.findall(_q("GroupRange")) and int(r.get("RangeStart")) <= raw <= int(r.get("RangeEnd"))
                    ]
                    ElementTree.SubElement(
                        middle,
                        _q("GroupAddress"),
                        Id=f"{_PROJECT}-0_GA-{9000 + number}",
                        Address=str(raw),
                        Name=name,
                        DatapointType="DPST-1-1",
                        Puid=str(9000 + number),
                    )
                for address, comm_objects in (devices or {}).items():
                    _add_device(root, address, [[_ga_id(root, raw) for raw in raws] for raws in comm_objects])
                data = ElementTree.tostring(root, encoding="utf-8", xml_declaration=True)
            zout.writestr(info, data)
    return out.getvalue()


@dataclass
class GroupRangeSpec:
    """One ETS group range of :func:`knxproj_with_layout`: name, raw bounds, addresses and nested ranges."""

    name: str
    start: int
    end: int
    addresses: dict[int, str] = field(default_factory=dict)  # raw address → ETS name
    ranges: list[GroupRangeSpec] = field(default_factory=list)


@dataclass
class RoomSpec:
    """One room of :func:`knxproj_with_layout` with its ETS functions (name → raw addresses)."""

    name: str
    functions: dict[str, list[int]] = field(default_factory=dict)


def raw_address(main: int, middle: int, sub: int) -> int:
    """Raw 16-bit value of the three-level address ``main/middle/sub``."""
    return (main << 11) | (middle << 8) | sub


def knxproj_with_layout(
    style: str,
    ranges: list[GroupRangeSpec],
    rooms: list[RoomSpec] | None = None,
    floor: str = "EG",
    devices: dict[int, list[list[int]]] | None = None,
) -> bytes:
    """Return the demo project in ``style`` with its group ranges replaced by ``ranges`` (#1266).

    The demo's group addresses are dropped, so only the given ones are imported. With
    ``rooms`` the demo building gets a floor ``floor`` holding these rooms, each with
    its ETS functions referencing raw addresses of ``ranges``. ``devices`` adds devices
    on line 1.1 as in :func:`knxproj_with_extra_group_addresses` (device address → one
    list of raw addresses of ``ranges`` per communication object). ETS ties the range
    layout to the style (three-level: main → middle, two-level: main only, free:
    any nesting); this helper writes what it is given.
    """
    if style not in STYLES:
        raise ValueError(style)
    ElementTree.register_namespace("", _NS)
    ElementTree.register_namespace("xsi", "http://www.w3.org/2001/XMLSchema-instance")
    ElementTree.register_namespace("xsd", "http://www.w3.org/2001/XMLSchema")
    counter = iter(range(10_000, 100_000))
    ga_ids: dict[int, str] = {}

    def add_range(parent: ElementTree.Element, spec: GroupRangeSpec) -> None:
        number = next(counter)
        element = ElementTree.SubElement(
            parent,
            _q("GroupRange"),
            Id=f"{_PROJECT}-0_GR-{number}",
            RangeStart=str(spec.start),
            RangeEnd=str(spec.end),
            Name=spec.name,
            Puid=str(number),
        )
        for raw, name in spec.addresses.items():
            number = next(counter)
            ga_ids[raw] = f"{_PROJECT}-0_GA-{number}"
            ElementTree.SubElement(
                element, _q("GroupAddress"), Id=ga_ids[raw], Address=str(raw), Name=name, DatapointType="DPST-1-1", Puid=str(number)
            )
        for child in spec.ranges:
            add_range(element, child)

    out = io.BytesIO()
    with zipfile.ZipFile(DEMO_KNXPROJ) as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            data = zin.read(info.filename)
            if info.filename == f"{_PROJECT}/project.xml":
                data = data.replace(b'GroupAddressStyle="ThreeLevel"', f'GroupAddressStyle="{style}"'.encode())
            elif info.filename == f"{_PROJECT}/0.xml":
                root = ElementTree.fromstring(data)
                group_ranges = root.find(f".//{_q('GroupAddresses')}/{_q('GroupRanges')}")
                for child in list(group_ranges):
                    group_ranges.remove(child)
                for spec in ranges:
                    add_range(group_ranges, spec)
                if rooms:
                    building = root.find(f".//{_q('Locations')}/{_q('Space')}")
                    number = next(counter)
                    floor_el = ElementTree.SubElement(
                        building, _q("Space"), Type="Floor", Id=f"{_PROJECT}-0_BP-{number}", Name=floor, Puid=str(number)
                    )
                    for room in rooms:
                        number = next(counter)
                        room_el = ElementTree.SubElement(
                            floor_el, _q("Space"), Type="Room", Id=f"{_PROJECT}-0_BP-{number}", Name=room.name, Puid=str(number)
                        )
                        for function_name, addresses in room.functions.items():
                            number = next(counter)
                            function_id = f"{_PROJECT}-0_F-{number}"
                            function = ElementTree.SubElement(
                                room_el, _q("Function"), Id=function_id, Name=function_name, Type="SwitchableLight", Puid=str(number)
                            )
                            for index, raw in enumerate(addresses, start=1):
                                number = next(counter)
                                ElementTree.SubElement(
                                    function,
                                    _q("GroupAddressRef"),
                                    Id=f"{function_id}_GR-{index}",
                                    RefId=ga_ids[raw],
                                    Name=f"Ref {index}",
                                    Role="SwitchOnOff",
                                    Puid=str(number),
                                )
                for address, comm_objects in (devices or {}).items():
                    _add_device(root, address, [[ga_ids[raw] for raw in raws] for raws in comm_objects])
                data = ElementTree.tostring(root, encoding="utf-8", xml_declaration=True)
            zout.writestr(info, data)
    return out.getvalue()


LIGHTING_NAMES = ("01 Esszimmer - Spots", "02 Kueche - Decke")


def lighting_layout(main: int) -> list[GroupRangeSpec]:
    """Three-level ``Beleuchtung › Schalten|Status|Dimmen`` in main group ``main`` (#1266).

    Names repeat over the middle groups, and ``01 Esszimmer - Spots`` is twice in ``Schalten``.
    """
    spots, ceiling = LIGHTING_NAMES
    return [
        GroupRangeSpec(
            "Beleuchtung",
            raw_address(main, 0, 0),
            raw_address(main, 7, 255),
            ranges=[
                GroupRangeSpec(
                    "Schalten",
                    raw_address(main, 1, 0),
                    raw_address(main, 1, 255),
                    {raw_address(main, 1, 1): spots, raw_address(main, 1, 2): ceiling, raw_address(main, 1, 3): spots},
                ),
                GroupRangeSpec(
                    "Status", raw_address(main, 2, 0), raw_address(main, 2, 255), {raw_address(main, 2, 1): spots, raw_address(main, 2, 2): ceiling}
                ),
                GroupRangeSpec("Dimmen", raw_address(main, 3, 0), raw_address(main, 3, 255), {raw_address(main, 3, 1): spots}),
            ],
        )
    ]


def two_level_lighting_layout(main: int) -> list[GroupRangeSpec]:
    """Two-level ``Beleuchtung`` in main group ``main``, no middle groups (#1266)."""
    start = raw_address(main, 0, 0)
    spots, ceiling = LIGHTING_NAMES
    return [GroupRangeSpec("Beleuchtung", start, start + 2047, {start + 1: spots, start + 300: ceiling})]
