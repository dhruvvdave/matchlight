import type { AgentName } from '@matchlight/schema';
import type { ZodType, ZodTypeDef } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { toFunctionSpec, type Tool } from './tools.js';

export interface LlmRequest<T> {
  agent: AgentName;
  system: string;
  user: string;
  schema: ZodType<T, ZodTypeDef, unknown>;
  schemaName: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** Tools the model may call before producing its structured answer. */
  tools?: Tool[];
  /** Deterministic offline "brain" used by the mock provider. Receives the attempt number. */
  mock: () => T | Promise<T>;
  /** Called for every tool invocation (for tracing). */
  onToolCall?: (name: string, args: unknown, result: unknown) => void;
}

export interface LlmResult<T> {
  data: T;
  provider: 'mock' | 'azure-openai';
  model: string;
  latency_ms: number;
  usage?: { prompt_tokens: number; completion_tokens: number };
  tool_calls: number;
}

export interface LlmClient {
  readonly provider: 'mock' | 'azure-openai';
  readonly model: string;
  complete<T>(req: LlmRequest<T>): Promise<LlmResult<T>>;
}

export class LlmTimeoutError extends Error {}

/**
 * Offline provider: runs each agent's deterministic mock brain, optionally with simulated latency
 * so the async narrative path (and its fallback) behaves like the real thing in demos.
 */
export class MockLlm implements LlmClient {
  readonly provider = 'mock' as const;
  readonly model = 'mock-llm';
  private n = 0;
  constructor(private readonly latency: { min: number; max: number } = { min: 0, max: 0 }) {}

  async complete<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    const t0 = performance.now();
    const span = this.latency.max - this.latency.min;
    // Deterministic pseudo-latency (no Math.random) so replays are reproducible.
    const delay = this.latency.min + (span > 0 ? (((this.n++ * 7919) % 1000) / 1000) * span : 0);
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    if (req.timeoutMs !== undefined && delay > req.timeoutMs)
      throw new LlmTimeoutError(`mock latency ${delay}ms > ${req.timeoutMs}ms`);
    const data = req.schema.parse(await req.mock());
    return {
      data,
      provider: 'mock',
      model: this.model,
      latency_ms: Math.round(performance.now() - t0),
      tool_calls: 0,
    };
  }
}

export interface AzureOpenAiConfig {
  endpoint: string;
  deployment: string;
  apiVersion: string;
  apiKey?: string;
}

/**
 * Azure OpenAI (Azure AI Foundry) provider: structured outputs via JSON schema + function calling loop.
 * Uses an API key if given, otherwise keyless Entra ID (Managed Identity / DefaultAzureCredential).
 */
export class AzureOpenAiLlm implements LlmClient {
  readonly provider = 'azure-openai' as const;
  readonly model: string;
  private clientPromise: Promise<{
    chat: {
      completions: {
        create: (body: Record<string, unknown>, opts?: { signal?: AbortSignal }) => Promise<ChatCompletion>;
      };
    };
  }>;

  constructor(private readonly cfg: AzureOpenAiConfig) {
    this.model = cfg.deployment;
    this.clientPromise = (async () => {
      const { AzureOpenAI } = await import('openai');
      if (cfg.apiKey) {
        return new AzureOpenAI({
          endpoint: cfg.endpoint,
          apiKey: cfg.apiKey,
          apiVersion: cfg.apiVersion,
          deployment: cfg.deployment,
        }) as never;
      }
      const { DefaultAzureCredential, getBearerTokenProvider } = await import('@azure/identity');
      const azureADTokenProvider = getBearerTokenProvider(
        new DefaultAzureCredential(),
        'https://cognitiveservices.azure.com/.default',
      );
      return new AzureOpenAI({
        endpoint: cfg.endpoint,
        azureADTokenProvider,
        apiVersion: cfg.apiVersion,
        deployment: cfg.deployment,
      }) as never;
    })();
  }

  async complete<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    const client = await this.clientPromise;
    const t0 = performance.now();
    const ctrl = new AbortController();
    const timer = req.timeoutMs ? setTimeout(() => ctrl.abort(), req.timeoutMs) : undefined;
    const messages: ChatMessage[] = [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ];
    const tools = req.tools?.map(toFunctionSpec);
    const jsonSchema = zodToJsonSchema(req.schema, { $refStrategy: 'none', target: 'openApi3' }) as Record<
      string,
      unknown
    >;
    let usage = { prompt_tokens: 0, completion_tokens: 0 };
    let toolCalls = 0;
    try {
      for (let step = 0; step < 5; step++) {
        const allowTools = tools && tools.length && step < 4;
        const res = await client.chat.completions.create(
          {
            model: this.cfg.deployment,
            messages,
            temperature: req.temperature ?? 0.2,
            max_tokens: req.maxTokens ?? 500,
            ...(allowTools ? { tools, tool_choice: 'auto' } : {}),
            response_format: {
              type: 'json_schema',
              json_schema: { name: req.schemaName, schema: jsonSchema, strict: false },
            },
          },
          { signal: ctrl.signal },
        );
        usage = {
          prompt_tokens: usage.prompt_tokens + (res.usage?.prompt_tokens ?? 0),
          completion_tokens: usage.completion_tokens + (res.usage?.completion_tokens ?? 0),
        };
        const msg = res.choices[0]?.message;
        if (msg?.tool_calls?.length && allowTools) {
          messages.push(msg as ChatMessage);
          for (const call of msg.tool_calls) {
            toolCalls++;
            const tool = req.tools!.find((t) => t.name === call.function.name);
            let result: unknown;
            try {
              const args = tool
                ? tool.parameters.parse(JSON.parse(call.function.arguments || '{}'))
                : undefined;
              result = tool ? tool.run(args) : { error: `unknown tool ${call.function.name}` };
              req.onToolCall?.(call.function.name, args, result);
            } catch (e) {
              result = { error: (e as Error).message };
            }
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify(result).slice(0, 6000),
            });
          }
          continue;
        }
        const content = msg?.content ?? '{}';
        const data = req.schema.parse(JSON.parse(content));
        return {
          data,
          provider: 'azure-openai',
          model: this.model,
          latency_ms: Math.round(performance.now() - t0),
          usage,
          tool_calls: toolCalls,
        };
      }
      throw new Error('tool loop exceeded');
    } catch (e) {
      if (ctrl.signal.aborted) throw new LlmTimeoutError(`Azure OpenAI exceeded ${req.timeoutMs}ms`);
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

interface ChatCompletion {
  choices: {
    message: {
      content: string | null;
      tool_calls?: { id: string; function: { name: string; arguments: string } }[];
    };
  }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}
type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
};
