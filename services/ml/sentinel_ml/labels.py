"""Python port of packages/shared/src/labels.ts. Both run the same test vectors."""

from __future__ import annotations

import re

ATTACK_CLASSES = (
    "Normal",
    "DDoS",
    "DoSHulk",
    "DoSSlowloris",
    "DoSGoldenEye",
    "FTPPatator",
    "SSHPatator",
    "PortScan",
    "Botnet",
    "Infiltration",
    "WebAttack",
    "XSS",
    "SQLInjection",
    "Heartbleed",
)

CRITICAL_CLASSES = ("DDoS", "Botnet", "Heartbleed")


def _clean(raw: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", raw.lower()).strip()


_CANONICAL = {_clean(c): c for c in ATTACK_CLASSES}

# Anchored, first match wins: a label is accepted only when it matches a known
# spelling as a whole, never because it contains a keyword.
_PATTERNS = [
    (re.compile(r"^(benign|normal)$"), "Normal"),
    (re.compile(r"^ddos( loit)?$"), "DDoS"),
    (re.compile(r"^dos ?hulk$"), "DoSHulk"),
    (re.compile(r"^dos ?goldeneye$"), "DoSGoldenEye"),
    (re.compile(r"^dos ?(slowloris|slowhttptest)$"), "DoSSlowloris"),
    (re.compile(r"^ftp ?patator$"), "FTPPatator"),
    (re.compile(r"^ssh ?patator$"), "SSHPatator"),
    (re.compile(r"^port ?scan$"), "PortScan"),
    (re.compile(r"^(bot|botnet)$"), "Botnet"),
    (re.compile(r"^infiltration$"), "Infiltration"),
    (re.compile(r"^heartbleed$"), "Heartbleed"),
    (re.compile(r"^web ?attack( .*)? brute force$"), "WebAttack"),
    (re.compile(r"^web ?attack$"), "WebAttack"),
    (re.compile(r"^(web ?attack( .*)? )?xss$"), "XSS"),
    (re.compile(r"^(web ?attack( .*)? )?sql ?injection$"), "SQLInjection"),
]


def normalize_label(raw: object) -> str | None:
    """Canonical class for a raw dataset label, or None when unknown (skip and log, never guess)."""
    if not isinstance(raw, str):
        return None
    c = _clean(raw)
    if not c:
        return None
    if c in _CANONICAL:
        return _CANONICAL[c]
    for pattern, cls in _PATTERNS:
        if pattern.match(c):
            return cls
    return None
