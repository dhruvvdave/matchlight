"""HTTP sidecar exposing the MAF workflow to the TypeScript orchestrator (POST /explain)."""

from __future__ import annotations

import os

from aiohttp import web

from .workflow import ExplainRequest, make_chat_client, result_to_json, run_explain

_client = None


async def explain(request: web.Request) -> web.Response:
    global _client
    body = await request.json()
    req = ExplainRequest(
        moment=body["moment"],
        facts=body["facts"],
        allowed_names=body.get("allowed_names", []),
        disallowed_names=body.get("disallowed_names", []),
        known_event_ids=body.get("known_event_ids", []),
        max_attempts=int(body.get("max_attempts", 3)),
    )
    _client = _client or make_chat_client()
    result = await run_explain(req, _client)
    return web.json_response(result_to_json(result))


async def health(_: web.Request) -> web.Response:
    return web.json_response({"ok": True, "framework": "microsoft-agent-framework", "llm": "azure-openai" if os.environ.get("AZURE_OPENAI_ENDPOINT") else "offline"})


def app() -> web.Application:
    a = web.Application()
    a.router.add_post("/explain", explain)
    a.router.add_get("/healthz", health)
    return a


if __name__ == "__main__":
    web.run_app(app(), port=int(os.environ.get("PORT", "8790")))
