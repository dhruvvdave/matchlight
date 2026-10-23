"""
Explainer <-> Critic as a Microsoft Agent Framework workflow.

    ExplainRequest ──► [ExplainerExecutor: MAF Agent + chat client] ──Draft──► [CriticExecutor]
                               ▲                                                   │
                               └──────────── CriticFeedback (rejected) ◄───────────┘
                                                                                   │ grounded / out of attempts
                                                                                   ▼
                                                                          yield ExplainResult

The chat client is Azure OpenAI (Azure AI Foundry deployment) when configured, otherwise a deterministic
offline client so the workflow (and its reject -> regenerate loop) runs in CI without cloud keys.
"""

from __future__ import annotations

import json
import os
import zlib
from dataclasses import asdict, dataclass, field
from typing import Any

from agent_framework import (
    Agent,
    BaseChatClient,
    ChatResponse,
    Executor,
    Message,
    WorkflowBuilder,
    WorkflowContext,
    handler,
)

from .critic import GroundingContext, check_draft

EXPLAINER_INSTRUCTIONS = """You are the Explainer agent in a live football (soccer) match-intelligence system.
Answer "why does this moment matter?" using ONLY the supplied facts. Every number and player name must appear
in a fact. Cite 1-4 facts by fact_id. Direction words must match the sign of each fact's delta.
Return ONLY JSON: {"claim": str, "evidence": [{"fact_id": str, "text": str}], "confidence": float, "event_ids": [str]}"""


@dataclass
class ExplainRequest:
    moment: dict[str, Any]
    facts: list[dict[str, Any]]
    allowed_names: list[str] = field(default_factory=list)
    disallowed_names: list[str] = field(default_factory=list)
    known_event_ids: list[str] = field(default_factory=list)
    max_attempts: int = 3


@dataclass
class Draft:
    request: ExplainRequest
    attempt: int
    draft: dict[str, Any]
    raw: str


@dataclass
class CriticFeedback:
    request: ExplainRequest
    attempt: int
    issues: list[dict[str, str]]


@dataclass
class ExplainResult:
    draft: dict[str, Any]
    grounded: bool
    attempts: int
    issues: list[dict[str, str]]
    events: list[dict[str, Any]]


def _prompt(req: ExplainRequest, feedback: list[dict[str, str]] | None) -> str:
    body: dict[str, Any] = {
        "moment": req.moment,
        "facts": [
            {k: f.get(k) for k in ("id", "text", "value", "previous", "delta", "event_ids")} for f in req.facts
        ],
    }
    if feedback:
        body["critic_feedback"] = feedback
    return json.dumps(body)


class OfflineChatClient(BaseChatClient):
    """Deterministic stand-in for Azure OpenAI: drafts from the facts; the first draft for some moments
    contains an injected error so the Critic loop is exercised end-to-end without cloud keys."""

    def __init__(self, hallucination_rate: float = 0.25) -> None:
        super().__init__()
        self.hallucination_rate = hallucination_rate

    async def _inner_get_response(self, *, messages, stream, options, **kwargs):  # type: ignore[override]
        payload = json.loads(messages[-1].text)
        facts = payload["facts"]
        moment = payload["moment"]
        claim = f"{moment.get('headline', 'Key moment')}: " + "; ".join(f["text"] for f in facts[:2])
        h = zlib.crc32(str(moment.get("id")).encode()) % 1000
        if "critic_feedback" not in payload and h < self.hallucination_rate * 1000:
            claim += " They have won 7 of their last 9 duels."
        draft = {
            "claim": claim,
            "evidence": [{"fact_id": f["id"], "text": f["text"]} for f in facts[:3]],
            "confidence": round(min(0.9, 0.55 + 0.1 * min(3, len(facts))), 2),
            "event_ids": sorted({e for f in facts for e in (f.get("event_ids") or [])})[:8],
        }
        return ChatResponse(messages=[Message("assistant", [json.dumps(draft)])], model="offline-mock")


def make_chat_client() -> BaseChatClient:
    endpoint = os.environ.get("AZURE_OPENAI_ENDPOINT")
    if not endpoint:
        return OfflineChatClient(float(os.environ.get("MOCK_HALLUCINATION_RATE", "0.25")))
    from agent_framework.openai import OpenAIChatCompletionClient

    kwargs: dict[str, Any] = {
        "model": os.environ.get("AZURE_OPENAI_DEPLOYMENT", "gpt-4o-mini"),
        "azure_endpoint": endpoint,
        "api_version": os.environ.get("AZURE_OPENAI_API_VERSION", "2024-10-21"),
    }
    if os.environ.get("AZURE_OPENAI_API_KEY"):
        kwargs["api_key"] = os.environ["AZURE_OPENAI_API_KEY"]
    else:
        from azure.identity import DefaultAzureCredential

        kwargs["credential"] = DefaultAzureCredential()
    return OpenAIChatCompletionClient(**kwargs)


def _parse(text: str) -> dict[str, Any]:
    start, end = text.find("{"), text.rfind("}")
    try:
        return json.loads(text[start : end + 1]) if start >= 0 else {}
    except json.JSONDecodeError:
        return {}


class ExplainerExecutor(Executor):
    def __init__(self, agent: Agent, log: list[dict[str, Any]]) -> None:
        super().__init__(id="explainer")
        self.agent = agent
        self.log = log

    async def _draft(self, req: ExplainRequest, attempt: int, feedback, ctx: WorkflowContext[Draft]) -> None:
        response = await self.agent.run(_prompt(req, feedback))
        draft = _parse(response.text)
        self.log.append({"agent": "explainer", "op": "draft" if attempt == 0 else f"redraft #{attempt}", "summary": str(draft.get("claim", ""))[:140]})
        await ctx.send_message(Draft(req, attempt, draft, response.text))

    @handler
    async def on_request(self, req: ExplainRequest, ctx: WorkflowContext[Draft]) -> None:
        await self._draft(req, 0, None, ctx)

    @handler
    async def on_feedback(self, fb: CriticFeedback, ctx: WorkflowContext[Draft]) -> None:
        await self._draft(fb.request, fb.attempt, fb.issues, ctx)


class CriticExecutor(Executor):
    def __init__(self, log: list[dict[str, Any]]) -> None:
        super().__init__(id="critic")
        self.log = log

    @handler
    async def on_draft(self, d: Draft, ctx: WorkflowContext[CriticFeedback, ExplainResult]) -> None:
        req = d.request
        gctx = GroundingContext(
            facts=req.facts,
            minute_label=str(req.moment.get("minute_label", "")),
            allowed_names=req.allowed_names,
            disallowed_names=req.disallowed_names,
            known_event_ids=set(req.known_event_ids),
        )
        issues = check_draft(d.draft, gctx)
        self.log.append({"agent": "critic", "op": "groundedness", "status": "ok" if not issues else "rejected", "summary": "grounded" if not issues else "; ".join(i["detail"] for i in issues)})
        if not issues:
            await ctx.yield_output(ExplainResult(d.draft, True, d.attempt + 1, [], self.log))
        elif d.attempt + 1 < req.max_attempts:
            await ctx.send_message(CriticFeedback(req, d.attempt + 1, issues))
        else:
            await ctx.yield_output(ExplainResult(d.draft, False, d.attempt + 1, issues, self.log))


async def run_explain(req: ExplainRequest, client: BaseChatClient | None = None) -> ExplainResult:
    """Build and run the Explainer <-> Critic workflow for one moment."""
    log: list[dict[str, Any]] = []
    agent = Agent(client or make_chat_client(), instructions=EXPLAINER_INSTRUCTIONS, name="matchlight-explainer")
    explainer = ExplainerExecutor(agent, log)
    critic = CriticExecutor(log)
    workflow = (
        WorkflowBuilder(start_executor=explainer, name="explain-with-critic", max_iterations=12)
        .add_edge(explainer, critic)
        .add_edge(critic, explainer)
        .build()
    )
    result = await workflow.run(req)
    outputs = result.get_outputs()
    if not outputs:
        return ExplainResult({}, False, 0, [{"code": "schema", "detail": "workflow produced no output"}], log)
    return outputs[-1]


def result_to_json(r: ExplainResult) -> dict[str, Any]:
    return asdict(r)
