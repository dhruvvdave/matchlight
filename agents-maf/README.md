# matchlight-maf: Explainer ⇄ Critic on Microsoft Agent Framework

An optional Python sidecar that runs Matchlight's **Explainer → Critic → (regenerate)** loop as a
[Microsoft Agent Framework](https://github.com/microsoft/agent-framework) workflow:

- `ExplainerExecutor` wraps a MAF `Agent` backed by **Azure OpenAI** (`OpenAIChatCompletionClient` with an
  Azure endpoint and Entra ID credential); offline it uses a deterministic `OfflineChatClient`.
- `CriticExecutor` runs the groundedness checks and either yields the result or sends `CriticFeedback`
  back along a workflow edge, so regeneration is a real graph cycle (`WorkflowBuilder.add_edge`).

The TypeScript orchestrator calls it when `MAF_ENDPOINT` is set (and still re-verifies the result with its
own Critic, defence in depth). Without it, the TS runtime runs the same contract in-process.

```bash
cd agents-maf
python -m venv .venv && . .venv/bin/activate
pip install -e '.[dev]'
pytest                       # offline: exercises the reject -> regenerate loop
python -m matchlight_maf.server   # POST http://localhost:8790/explain
```
