"""Groundedness checks (Python port of agents/src/critic.ts, numbers + entities + citations)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

_NUM = re.compile(r"(?<![\w.])(\d+(?:[.,]\d+)?)(?![\w])")


@dataclass
class GroundingContext:
    facts: list[dict[str, Any]]
    minute_label: str
    allowed_names: list[str] = field(default_factory=list)
    disallowed_names: list[str] = field(default_factory=list)
    known_event_ids: set[str] = field(default_factory=set)


def _allowed_numbers(ctx: GroundingContext) -> list[float]:
    out: list[float] = []

    def push(v: Any) -> None:
        if isinstance(v, (int, float)):
            out.extend([float(v), abs(float(v))])
        elif isinstance(v, str):
            out.extend(float(m) for m in re.findall(r"\d+(?:\.\d+)?", v))

    for f in ctx.facts:
        for k in ("value", "previous", "delta"):
            push(f.get(k))
        for v in (f.get("params") or {}).values():
            push(v)
        push(f.get("text"))  # canonical fact text is generated from data
    push(ctx.minute_label)
    return out


def _supported(n: float, allowed: list[float]) -> bool:
    return any(
        abs(n - a) < 0.006 or n == round(a) or abs(n - round(a, 1)) < 0.006 or abs(n - round(a * 100)) < 0.006
        for a in allowed
    )


def _strip_tokens(text: str, ctx: GroundingContext) -> str:
    tokens = {ctx.minute_label}
    for f in ctx.facts:
        if isinstance(f.get("value"), str):
            tokens.add(f["value"])
        for v in (f.get("params") or {}).values():
            if isinstance(v, str):
                tokens.add(v)
    for t in sorted((t for t in tokens if re.search(r"\d", t)), key=len, reverse=True):
        text = re.sub(rf"(?<![\d.,/]){re.escape(t)}(?![\d/])", " ", text)
    return text


def check_draft(draft: dict[str, Any], ctx: GroundingContext) -> list[dict[str, str]]:
    """Return a list of issues ({code, detail}); empty means grounded."""
    issues: list[dict[str, str]] = []
    claim = draft.get("claim")
    evidence = draft.get("evidence") or []
    if not isinstance(claim, str) or len(claim) < 8:
        return [{"code": "schema", "detail": "claim missing or too short"}]
    fact_ids = {f["id"] for f in ctx.facts}
    if not evidence:
        issues.append({"code": "empty_evidence", "detail": "no evidence cited"})
    for ev in evidence:
        if ev.get("fact_id") not in fact_ids:
            issues.append({"code": "unknown_fact", "detail": f"cites {ev.get('fact_id')}, which does not exist"})
    for eid in draft.get("event_ids") or []:
        if ctx.known_event_ids and eid not in ctx.known_event_ids:
            issues.append({"code": "unknown_event", "detail": f"event {eid} not in the event store"})
    text = " ".join([claim, *[str(e.get("text", "")) for e in evidence]])
    allowed = _allowed_numbers(ctx)
    for m in _NUM.finditer(_strip_tokens(text, ctx)):
        n = float(m.group(1).replace(",", "."))
        if not _supported(n, allowed):
            issues.append({"code": "unsupported_number", "detail": f'"{m.group(1)}" is not backed by any fact'})
    for name in ctx.disallowed_names:
        surname = name.split(" ", 1)[-1]
        if surname and re.search(rf"\b{re.escape(surname)}\b", text) and not any(surname in a for a in ctx.allowed_names):
            issues.append({"code": "unsupported_entity", "detail": f"mentions {name}, who is not in the evidence"})
    conf = draft.get("confidence", 0.5)
    if isinstance(conf, (int, float)) and conf > (0.95 if len(evidence) >= 2 else 0.85):
        issues.append({"code": "overconfident", "detail": f"confidence {conf} too high for the evidence"})
    return issues
