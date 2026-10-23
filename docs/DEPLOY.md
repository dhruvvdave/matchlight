# Deploy guide

## Option A: one command to Azure (`azd up`)

Prerequisites: [Azure Developer CLI](https://aka.ms/azd), Azure CLI, an Azure subscription with access to Azure OpenAI, and Docker (or use `remoteBuild`, already enabled).

```bash
azd auth login
azd init -e matchlight-dev            # first time only, in the repo root
azd env set AZURE_LOCATION swedencentral   # any region with gpt-4o-mini GlobalStandard + Container Apps
azd up
```

`azd up` provisions [`infra/main.bicep`](../infra/main.bicep), builds the images in Azure Container Registry, and deploys:

| Resource                                                | Purpose                                                         | Auth                                                                      |
| ------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Azure Container Apps: `ca-matchlight-api-*`             | API, session loop, all TS agents                                | user-assigned managed identity                                            |
| Azure Container Apps: `ca-ml-maf-*` (internal ingress)  | Microsoft Agent Framework Explainer ⇄ Critic workflow           | managed identity                                                          |
| Azure Static Web Apps: `swa-matchlight-*`               | web UI (`VITE_API_BASE` is wired to the API URL by an azd hook) | n/a                                                                       |
| Azure OpenAI: `oai-*` + `gpt-4o-mini` deployment        | LLM agents                                                      | Entra ID only (`disableLocalAuth`), role _Cognitive Services OpenAI User_ |
| Azure AI Translator: `trl-*`                            | multilingual narrative                                          | key stored as a Container Apps secret                                     |
| Azure AI Speech: `spch-*`                               | TTS + recap MP3                                                 | key stored as a Container Apps secret                                     |
| Azure Web PubSub: `wps-*` (Free)                        | real-time push                                                  | Entra ID only, role _Web PubSub Service Owner_                            |
| Azure Cosmos DB: `cosmos-*` (serverless)                | events, explanations, recaps                                    | Entra ID only, _Cosmos DB Built-in Data Contributor_                      |
| Container Registry, Log Analytics, Application Insights | images, logs (agent traces are JSON-logged with `TRACE_LOG=1`)  | AcrPull via managed identity                                              |

Outputs: `WEB_URL` (open this), `API_URL`, endpoints for OpenAI, Web PubSub and Cosmos DB.

Tear down with `azd down --purge`.

### Notes

- **Model availability:** if `gpt-4o-mini` `GlobalStandard` isn't offered in your region, change `openAiModel` / `openAiModelVersion` in `infra/main.bicep` or pick another region.
- **One API replica:** live sessions are in memory, so `maxReplicas: 1`. See [ARCHITECTURE.md](ARCHITECTURE.md#scaling-notes).
- **CORS:** the API allows the Static Web App origin and `http://localhost:5173`.

## Option B: container anywhere

```bash
docker compose up --build                # offline mode on http://localhost:8787
docker compose --profile maf up --build  # + Microsoft Agent Framework sidecar (set MAF_ENDPOINT=http://maf:8790)
```

To use real Azure services from a local container, put the variables from [`.env.example`](../.env.example) into `.env` (API keys work locally; managed identity is used in Azure).

If Docker Hub is rate-limited, build from Microsoft's registry:
`docker build --build-arg NODE_IMAGE=mcr.microsoft.com/azurelinux/base/nodejs:20 -t matchlight .`

## Option C: local development

```bash
npm ci
npm run dev        # API (tsx watch, :8787) + Vite (:5173, proxies /api and the WebSocket hub)
```

## Environment variables

| Variable                                                               | Default                                             | Meaning                                               |
| ---------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------- |
| `MATCHLIGHT_LLM`                                                       | `azure` if `AZURE_OPENAI_ENDPOINT` set, else `mock` | LLM provider                                          |
| `AZURE_OPENAI_ENDPOINT` / `_DEPLOYMENT` / `_API_VERSION` / `_API_KEY`  | `gpt-4o-mini`, `2024-10-21`, keyless                | Azure OpenAI                                          |
| `MAF_ENDPOINT`                                                         | unset                                               | Microsoft Agent Framework sidecar URL                 |
| `AZURE_TRANSLATOR_KEY` / `_REGION` / `_ENDPOINT`                       | unset                                               | Azure AI Translator                                   |
| `AZURE_SPEECH_KEY` / `_REGION`                                         | unset                                               | Azure AI Speech                                       |
| `WEBPUBSUB_ENDPOINT` or `WEBPUBSUB_CONNECTION_STRING`, `WEBPUBSUB_HUB` | local emulator                                      | Azure Web PubSub                                      |
| `COSMOS_ENDPOINT` / `COSMOS_KEY` / `COSMOS_DATABASE`                   | in-memory                                           | Azure Cosmos DB                                       |
| `MOCK_LLM_LATENCY_MS`                                                  | `250-900`                                           | simulated model latency (offline)                     |
| `MOCK_HALLUCINATION_RATE`                                              | `0.2`                                               | injected first-draft errors (offline Critic demo)     |
| `NARRATIVE_BUDGET_MS`                                                  | `6000`                                              | LLM narrative deadline before the template line stays |
| `TRACE_LOG`                                                            | `0`                                                 | JSON-log every agent span                             |
| `PORT`, `CORS_ORIGIN`, `MAX_SESSIONS`, `WEB_DIST`, `PUBLIC_WS_URL`     |                                                     | server settings                                       |
