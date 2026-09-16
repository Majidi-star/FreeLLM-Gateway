import { z } from 'zod';

export const canonicalModelSeedSchema = z.object({
  canonicalId: z.string().min(1),
  displayName: z.string().min(1),
  developer: z.string().min(1),
  knownAliases: z.array(z.string()).default([]),
  contextWindow: z.number().int().positive(),
  benchmarks: z.object({
    reasoning: z.number().min(0).max(100).default(0),
    coding: z.number().min(0).max(100).default(0),
    commandExecution: z.number().min(0).max(100).default(0),
    math: z.number().min(0).max(100).default(0),
    vision: z.number().min(0).max(100).default(0),
    longContext: z.number().min(0).max(100).default(0),
  }),
  capabilities: z.object({
    supportsTools: z.boolean().default(false),
    supportsVision: z.boolean().default(false),
    supportsJsonMode: z.boolean().default(true),
  }),
});

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
  canonicalId: z.string().optional(),
  modelName: z.string().min(1),
  displayName: z.string().min(1),
  contextWindow: z.number().int().positive(),
  supportsTools: z.boolean().default(false),
  supportsVision: z.boolean().default(false),
  costInputPer1k: z.number().nonnegative().default(0),
  costOutputPer1k: z.number().nonnegative().default(0),
  benchTps: z.number().positive().nullable().optional(),
  benchTtftMs: z.number().positive().nullable().optional(),
  benchP95LatencyMs: z.number().positive().nullable().optional(),
  benchReasoningScore: z.number().min(0).max(100).nullable().optional(),
  benchCodingScore: z.number().min(0).max(100).nullable().optional(),
  benchCommandScore: z.number().min(0).max(100).nullable().optional(),
  benchMathScore: z.number().min(0).max(100).nullable().optional(),
  benchVisionScore: z.number().min(0).max(100).nullable().optional(),
  benchLongContextScore: z.number().min(0).max(100).nullable().optional(),
  taskFitness: z.record(z.string(), z.number()).default({}),
  isActive: z.boolean().default(true),
});

export type CanonicalModelSeed = z.infer<typeof canonicalModelSeedSchema>;
export type ProviderSeed = z.infer<typeof providerSeedSchema>;
export type ModelSeed = z.infer<typeof modelSeedSchema>;
