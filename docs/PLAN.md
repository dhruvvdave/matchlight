# Build plan (as executed)

## Architecture & tech choices

- **TypeScript monorepo** (npm workspaces). One Zod contract package types every service and generates the published JSON Schemas.
- **Agents in TypeScript**, in-process with the stats engine for the latency budget. **Microsoft Agent Framework (Python)** runs the Explainer ⇄ Critic workflow as an optional sidecar.
- **Push:** Azure Web PubSub groups (a local emulator speaks the same protocol). **State:** Cosmos DB. **Compute:** Container Apps. **Frontend:** Static Web Apps.
- **LLM:** Azure OpenAI (structured outputs + tools), with a deterministic mock for offline use and CI.

## Milestones

1. **Simulator + schemas**: seeded engine, scenarios with scripted beats, 1 Hz tracking, JSONL, generated JSON Schemas. ✅
2. **Stats engine + tests**: xG, xT, difficulty, PPDA, momentum, tempo, control, speed and distance, flags; calibrated against realistic distributions. ✅
3. **Render + pitch UI with template narration**: overlay builder, priority/debounce scheduler, localised templates. ✅
4. **Agents + Critic**: Director, Stats, Explainer, Critic, Narrator, Personalizer, Renderer, orchestrator with fast and async paths, golden tests. ✅
5. **Personalization + translation**: five modes, five languages (RTL), glossary, Azure Translator provider, TTS. ✅
6. **Recap + Ask**: article, script, timeline, ratings, exports; grounded Q&A. ✅
7. **Azure infra + deploy**: Bicep, azd, Dockerfile, compose, CI; MAF sidecar. ✅
8. **Docs + demo**: README, pitch, demo script, architecture, data model, agent contracts, rubric. ✅

Each milestone ended with the test suite and the app running (Playwright screenshots of the UI and Demo Mode were checked during development).
