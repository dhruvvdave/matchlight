import pytest

from matchlight_maf.critic import GroundingContext, check_draft
from matchlight_maf.workflow import ExplainRequest, OfflineChatClient, run_explain

FACTS = [
    {"id": "m1.f1", "label": "PPDA", "value": 6.1, "previous": 11.2, "delta": -5.1, "event_ids": ["e1"], "text": "HBA PPDA 11.2 -> 6.1", "params": {"from": 11.2, "to": 6.1, "w": 10}},
    {"id": "m1.f2", "label": "High turnovers", "value": 3, "event_ids": ["e2"], "text": "3 of the last 4 turnovers won high", "params": {"n": 3, "m": 4}},
]


def _req(moment_id: str) -> ExplainRequest:
    return ExplainRequest(
        moment={"id": moment_id, "kind": "pressing_shift", "minute_label": "64'", "headline": "Pressure shifted"},
        facts=FACTS,
        known_event_ids=["e1", "e2"],
    )


def test_critic_rejects_fabricated_numbers():
    ctx = GroundingContext(facts=FACTS, minute_label="64'")
    ok = {"claim": "PPDA dropped 11.2 -> 6.1 at 64'.", "evidence": [{"fact_id": "m1.f1", "text": "x"}], "confidence": 0.8, "event_ids": ["e1"]}
    bad = {**ok, "claim": "PPDA dropped 11.2 -> 2.7."}
    assert check_draft(ok, ctx) == []
    assert check_draft(bad, ctx)[0]["code"] == "unsupported_number"


async def test_workflow_regenerates_until_grounded():
    client = OfflineChatClient(hallucination_rate=1.0)  # every first draft is wrong
    res = await run_explain(_req("m-loop"), client)
    assert res.grounded
    assert res.attempts == 2
    assert [e["agent"] for e in res.events] == ["explainer", "critic", "explainer", "critic"]
    assert res.events[1]["status"] == "rejected"


async def test_workflow_first_try_when_clean():
    res = await run_explain(_req("m-clean"), OfflineChatClient(hallucination_rate=0.0))
    assert res.grounded and res.attempts == 1
