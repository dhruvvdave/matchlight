import { AzureOpenAiLlm, MockLlm, type LlmClient } from './runtime/llm.js';
import { AzureTranslatorProvider, LlmTranslationProvider, TranslatorAgent } from './translator.js';

export interface AgentConfig {
  llm: LlmClient;
  translator: TranslatorAgent;
  hallucinationRate: number;
  narrativeBudgetMs: number;
  /** Microsoft Agent Framework sidecar running the Explainer <-> Critic workflow (agents-maf/). */
  mafEndpoint?: string;
  describe: { llm: string; translator: string; orchestration: string };
}

/**
 * Build providers from environment variables. Without Azure settings everything runs offline:
 * a deterministic mock LLM (with optional simulated latency) and localised templates.
 */
export function agentConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const wantAzure = (env.MATCHLIGHT_LLM ?? (env.AZURE_OPENAI_ENDPOINT ? 'azure' : 'mock')) === 'azure';
  let llm: LlmClient;
  if (wantAzure && env.AZURE_OPENAI_ENDPOINT) {
    llm = new AzureOpenAiLlm({
      endpoint: env.AZURE_OPENAI_ENDPOINT,
      deployment: env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o-mini',
      apiVersion: env.AZURE_OPENAI_API_VERSION ?? '2024-10-21',
      apiKey: env.AZURE_OPENAI_API_KEY || undefined,
    });
  } else {
    const [min, max] = (env.MOCK_LLM_LATENCY_MS ?? '250-900').split('-').map(Number);
    llm = new MockLlm({ min: min || 0, max: max || min || 0 });
  }
  let translator: TranslatorAgent;
  if (env.AZURE_TRANSLATOR_KEY) {
    translator = new TranslatorAgent(
      new AzureTranslatorProvider({
        endpoint: env.AZURE_TRANSLATOR_ENDPOINT ?? 'https://api.cognitive.microsofttranslator.com',
        key: env.AZURE_TRANSLATOR_KEY,
        region: env.AZURE_TRANSLATOR_REGION,
      }),
    );
  } else if (llm.provider === 'azure-openai') {
    translator = new TranslatorAgent(new LlmTranslationProvider(llm));
  } else {
    translator = new TranslatorAgent(null);
  }
  return {
    llm,
    translator,
    hallucinationRate: Number(env.MOCK_HALLUCINATION_RATE ?? (llm.provider === 'mock' ? 0.2 : 0)),
    narrativeBudgetMs: Number(env.NARRATIVE_BUDGET_MS ?? 6000),
    mafEndpoint: env.MAF_ENDPOINT || undefined,
    describe: {
      orchestration: env.MAF_ENDPOINT
        ? 'Microsoft Agent Framework workflow (sidecar) + TS runtime'
        : 'TS agent runtime (MAF-style contracts)',
      llm: llm.provider === 'mock' ? 'mock (offline, deterministic)' : `Azure OpenAI (${llm.model})`,
      translator: translator.provider?.name ?? 'offline localised templates',
    },
  };
}
