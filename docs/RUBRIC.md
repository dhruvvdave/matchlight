# Rubric self-assessment

How Matchlight maps to the five judging criteria. Every claim links to code or a test.

## 1. Use of Microsoft / Azure technology

| Requirement                                  | Delivered                                                                                                                                                                   | Evidence                                                                                                   |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Azure OpenAI / Azure AI Foundry              | Structured outputs (JSON schema from Zod), function calling with tools, keyless Entra ID, timeouts and fallbacks                                                            | [`agents/src/runtime/llm.ts`](../agents/src/runtime/llm.ts), Bicep `oai-*`                                 |
| Microsoft Agent Framework                    | Explainer agent ⇄ Critic executor **workflow graph** with a feedback edge; Azure OpenAI chat client; HTTP sidecar; integrated into the TS orchestrator with re-verification | [`agents-maf/`](../agents-maf), [`tests/maf.test.ts`](../tests/maf.test.ts), `agents-maf/tests`            |
| Azure AI Translator                          | Dynamic-dictionary glossary for football terms, `notranslate` names, post-translation number check                                                                          | [`agents/src/translator.ts`](../agents/src/translator.ts), [`glossary.ts`](../agents/src/i18n/glossary.ts) |
| Azure AI Speech                              | Neural voices in 5 locales for commentary and the narrated recap MP3                                                                                                        | [`api/src/tts.ts`](../api/src/tts.ts)                                                                      |
| Azure Web PubSub                             | Group per match and per profile; least-privilege client tokens; local emulator with the same protocol                                                                       | [`api/src/transport`](../api/src/transport), [`tests/api.test.ts`](../tests/api.test.ts)                   |
| Container Apps / Cosmos DB / Static Web Apps | API + MAF sidecar; serverless Cosmos with chunked writes; SWA frontend                                                                                                      | [`infra/resources.bicep`](../infra/resources.bicep), [`cosmos-store.ts`](../api/src/store/cosmos-store.ts) |
| One-command deploy                           | `azd up` with Bicep, managed identity, RBAC, Log Analytics + App Insights                                                                                                   | [`azure.yaml`](../azure.yaml), [DEPLOY.md](DEPLOY.md)                                                      |
| Local fallback                               | Mock LLM, localised templates, Web PubSub emulator, in-memory store; no keys needed                                                                                         | [`agents/src/config.ts`](../agents/src/config.ts)                                                          |

## 2. Agentic design (orchestration, not a single prompt)

- **Ten agents with typed contracts** (Director, Stats, Explainer, Critic, Narrator, Personalizer, Translator, Renderer, Recap, Ask); see [AGENTS.md](AGENTS.md).
- **Tool calling:** the Stats tools are shared with the Explainer and Ask agents, and every tool call is traced.
- **Shared memory:** the Blackboard holds cooldowns, repetition counts, explanations and feeds.
- **Critic loop:** reject → regenerate → template fallback. The tests prove injected hallucinations are caught and never published ([`tests/agents.test.ts`](../tests/agents.test.ts), [`tests/critic.test.ts`](../tests/critic.test.ts), [`tests/maf.test.ts`](../tests/maf.test.ts)).
- **Groundedness contract:** `{claim, evidence[], confidence, event_ids[]}`, with every number, name and direction word checked, including after translation and in Arabic-Indic or Devanagari digits.
- **Latency budgets:** synchronous fast path p95 ≈ 4 ms (asserted < 1.5 s in tests); async LLM path supersedes template lines within a budget, otherwise the template stays.
- **Agent Trace panel:** live pipeline nodes light up, with rejections in red and p95 latency shown.

## 3. Insight quality & the five-stage pipeline

- **Ingest:** a realistic seeded engine. Formations, possession chains, pressing, momentum, fatigue, set pieces, cards, subs and tactical shifts produce realistic distributions (tested over many seeds). It ships 3 seeded stories plus "generate new match", 1 Hz tracking, JSONL export, clock speeds and seek. [`simulator/`](../simulator), [`tests/simulator.test.ts`](../tests/simulator.test.ts)
- **Interpret:** xG, xT, pass difficulty, PPDA and rolling PPDA, momentum, tempo, control-vs-chaos, speeds, distance, sprints, ratings, plus threshold flags. The test proves the comeback press is _detected_ (PPDA drops after the 61' switch). [`tests/stats-engine.test.ts`](../tests/stats-engine.test.ts)
- **Explain:** evidence-backed "why it matters" in the style of the brief, e.g. _"Pressure shifted: HBA are winning the ball back sooner, PPDA 9 → 2.7 over the last 10 minutes after the 62' tactical switch."_
- **Render:** JSON Schema-validated overlay contract with title-safe positions, RTL mirroring, priority/debounce scheduling and golden-file stability. [`tests/golden.test.ts`](../tests/golden.test.ts), [`tests/scheduler.test.ts`](../tests/scheduler.test.ts)
- **Personalize:** five modes and five languages that change selection and format, shown side by side in split view and asserted in tests.
- **Extras (all four delivered):** auto-eventing stub from tracking (precision and recall reported), Ask the match, recap export (Markdown/JSON/MP3), accessibility (high-contrast overlays, `aria-live` commentary, keyboard focus, reduced motion).

## 4. Engineering quality

- Monorepo with the requested layout; TypeScript end to end with **shared Zod contracts** generating JSON Schemas (drift test in CI).
- **63 TypeScript tests + 3 Python tests:** unit (stats, models, scheduler, critic), schema (Zod + Ajv), **deterministic seeded replay** (SHA-256 identical JSONL), **golden overlay file**, multi-agent behaviour, API + WebSocket integration, MAF contract.
- ESLint + Prettier + `tsc --noEmit`, GitHub Actions CI (format, lint, typecheck, tests, build, schema drift, Python MAF tests, Docker smoke test).
- Env-only config, `.env.example`, no secrets committed, managed identity in Azure.
- One-command run (`npm run dev`, `make docker` / `docker compose up`) and deploy (`azd up`).

## 5. UX & demo

- A floodlit broadcast UI: scorebug and clock, live canvas pitch with smoothed tracking, animated broadcast overlays, persona feed with "instant" vs "AI · grounded" chips, mode-specific insight strips (charts, player card, gauge), a momentum timeline with click-to-rewind markers, split screen, a recap modal, loading and error states, and a responsive mobile layout.
- **Demo Mode:** a scripted, deterministic 90-second tour (20×, persona and language switches, trace, ask, 60× to full time, recap); see [DEMO_SCRIPT.md](../DEMO_SCRIPT.md).
