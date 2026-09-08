import { z } from 'zod';

export const providerSeedSchema = z.object({
  slug: z.string().min(1),
  displayName: z.string().min(1),
  baseUrl: z.string().url(),
  authType: z.enum(['api_key', 'oauth', 'keyless']),
  protocol: z.enum(['openai', 'anthropic', 'gemini', 'custom']),
  docsUrl: z.string().url().optional(),
  capabilities: z.object({
    vision: z.boolean().default(false),
    tools: z.boolean().default(false),
    streaming: z.boolean().default(true),
    jsonMode: z.boolean().default(false),
  }).default({}),
  isActive: z.boolean().default(true),
});

export const modelSeedSchema = z.object({
  providerSlug: z.string().min(1),
  modelName: z.string().min(1),
  displayName: z.string().min(1),
  contextWindow: z.number().int().positive(),
  supportsTools: z.boolean().default(false),
  supportsVision: z.boolean().default(false),
  costInputPer1k: z.number().nonnegative().default(0),
  costOutputPer1k: z.number().nonnegative().default(0),
  benchTps: z.number().positive().optional(),
  benchTtftMs: z.number().positive().optional(),
  benchP95LatencyMs: z.number().positive().optional(),
  taskFitness: z.object({
    coding_agent: z.number().min(0).max(1).default(0.5),
    chatbot: z.number().min(0).max(1).default(0.5),
    batch: z.number().min(0).max(1).default(0.5),
    research: z.number().min(0).max(1).default(0.5),
    general: z.number().min(0).max(1).default(0.5),
  }).default({}),
  isActive: z.boolean().default(true),
});

export type ProviderSeed = z.infer<typeof providerSeedSchema>;
export type ModelSeed = z.infer<typeof modelSeedSchema>;
