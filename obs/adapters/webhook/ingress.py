"""Ingress address checks for the WEBHOOK adapter (issue #1256).

This is deliberately *not* ``obs/security/url_targets.py``.  That module is an
**egress** allowlist: it decides where OBS itself may connect to and protects
against SSRF towards private or internal targets.  The check here runs in the
opposite direction — which remote address may *reach* a webhook endpoint — so it
guards a different threat on a different code path.  Only the CIDR matching
technique (``ipaddress``) is shared, and that is cheap enough to keep separate
rather than bending the egress allowlist into serving both.
"""

from __future__ import annotations

import ipaddress

type IpNetwork = ipaddress.IPv4Network | ipaddress.IPv6Network

_SEPARATORS = ",;"


def split_entries(raw: str) -> list[str]:
    """Split a comma / semicolon / whitespace separated list into entries."""
    if not raw:
        return []
    normalised = raw
    for separator in _SEPARATORS:
        normalised = normalised.replace(separator, " ")
    return [part for part in normalised.split() if part]


def parse_networks(raw: str) -> list[IpNetwork]:
    """Parse an allowlist string into networks.

    A bare address (``192.168.1.5``) becomes its single-host network.  Invalid
    entries raise ``ValueError`` so the adapter config schema rejects them when
    the instance is saved instead of failing open at request time.
    """
    return [ipaddress.ip_network(entry, strict=False) for entry in split_entries(raw)]


def _normalise(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    """Unwrap IPv4-mapped IPv6 addresses so IPv4 CIDRs match them.

    A dual-stack listener reports a client that connected over IPv4 as
    ``::ffff:192.168.1.5``; without this an allowlist of ``192.168.1.0/24``
    would never match it.
    """
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        return address.ipv4_mapped
    return address


def address_allowed(client_ip: str | None, networks: list[IpNetwork]) -> bool:
    """Whether *client_ip* is covered by *networks*.

    An empty allowlist allows everything — that is the documented default, so
    an instance without an allowlist stays reachable.  A non-empty allowlist
    fails closed: an unknown or unparseable client address is rejected.
    """
    if not networks:
        return True
    if not client_ip:
        return False
    try:
        address = _normalise(ipaddress.ip_address(client_ip))
    except ValueError:
        return False
    return any(address in network for network in networks)


def _strip_port(value: str) -> str:
    """Remove a trailing port from a ``host[:port]`` / ``[v6]:port`` token."""
    if value.startswith("["):
        closing = value.find("]")
        return value[1:closing] if closing != -1 else value
    if value.count(":") == 1:
        return value.split(":", 1)[0]
    return value


def resolve_client_ip(peer_ip: str | None, forwarded_for: str | None, *, trust_forwarded_for: bool) -> str | None:
    """Return the address the allowlist and the rate limiter should judge.

    ``X-Forwarded-For`` is honoured only when the instance opts in.  On a
    directly reachable port that header is attacker-controlled, so trusting it
    by default would let any caller claim an allowlisted source address.  With
    a reverse proxy in front, the left-most entry is the original client as
    written by that proxy.
    """
    if trust_forwarded_for and forwarded_for:
        first = forwarded_for.split(",")[0].strip()
        if first:
            return _strip_port(first)
    return peer_ip
