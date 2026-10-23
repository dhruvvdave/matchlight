import type { ZodType, ZodTypeDef } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/** A typed tool an agent (or the LLM on its behalf) can call. */
export interface Tool<I = unknown, O = unknown> {
  name: string;
  description: string;
  parameters: ZodType<I, ZodTypeDef, unknown>;
  run(args: I): O;
}

export function defineTool<I, O>(t: Tool<I, O>): Tool<I, O> {
  return t;
}

/** OpenAI / Azure OpenAI function-calling spec for a tool. */
export function toFunctionSpec(t: Tool) {
  const schema = zodToJsonSchema(t.parameters, { $refStrategy: 'none', target: 'openApi3' }) as Record<
    string,
    unknown
  >;
  delete schema.$schema;
  return {
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: schema },
  };
}
