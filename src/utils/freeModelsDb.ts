export interface DBProvider {
  id: string;
  name: string;
  category: 'Permanent Free' | 'Trial Credits';
  website: string;
  signupUrl: string;
  limitsDescription: string;
  creditsDescription: string;
  models: { id: string; name: string }[];
}

export const FREE_PROVIDERS_DB: DBProvider[] = [
  {
    id: 'gemini',
    name: 'Google AI Studio',
    category: 'Permanent Free',
    website: 'https://aistudio.google.com',
    signupUrl: 'https://aistudio.google.com',
    limitsDescription: 'Gemini 3.5/2.5 Flash: 5 RPM, 20 RPD. Flash-Lite: 15 RPM, 500 RPD. Gemma 3/4: 30 RPM, 14,400 RPD.',
    creditsDescription: 'Permanently free tier. Data used for training outside of UK/CH/EEA/EU.',
    models: [
      { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash' },
      { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
      { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite' },
      { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite' },
      { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite' },
      { id: 'gemma-4-31b-instruct', name: 'Gemma 4 31B Instruct' },
      { id: 'gemma-3-27b-instruct', name: 'Gemma 3 27B Instruct' }
    ]
  },
  {
    id: 'groq',
    name: 'Groq',
    category: 'Permanent Free',
    website: 'https://console.groq.com',
    signupUrl: 'https://console.groq.com',
    limitsDescription: 'Llama 3.3 70B: 1,000 RPD / 12k TPM. Llama 3.1 8B: 14,400 RPD / 6k TPM.',
    creditsDescription: 'Permanently free api keys for various open models.',
    models: [
      { id: 'llama-3.3-70b-specdec', name: 'Llama 3.3 70B (Speculative Decoding)' },
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile' },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant' },
      { id: 'qwen3.6-27b', name: 'Qwen 3.6 27B' },
      { id: 'deepseek-r1-distill-qwen-32b', name: 'DeepSeek R1 Distill Qwen 32B' },
      { id: 'whisper-large-v3', name: 'Whisper Large v3 (Audio)' }
    ]
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    category: 'Permanent Free',
    website: 'https://openrouter.ai',
    signupUrl: 'https://openrouter.ai/keys',
    limitsDescription: 'Shared quota: 20 requests/minute, 50 requests/day. Up to 1000 RPD with a $10 one-time deposit.',
    creditsDescription: 'Aggregator with dozens of permanently free models (:free suffix).',
    models: [
      { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1 (Free)' },
      { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B Instruct (Free)' },
      { id: 'google/gemini-2.5-flash:free', name: 'Gemini 2.5 Flash (Free)' },
      { id: 'google/gemma-2-9b-it:free', name: 'Gemma 2 9B Instruct (Free)' },
      { id: 'cohere/north-mini-code:free', name: 'Cohere North Mini Code (Free)' }
    ]
  },
  {
    id: 'cohere',
    name: 'Cohere',
    category: 'Permanent Free',
    website: 'https://cohere.com',
    signupUrl: 'https://dashboard.cohere.com/api-keys',
    limitsDescription: 'Shared quota: 20 requests/minute, 1,000 requests/month.',
    creditsDescription: 'Permanently free developer key for trial and testing.',
    models: [
      { id: 'command-r-plus', name: 'Command R+ (Reasoning & Agents)' },
      { id: 'command-r', name: 'Command R' },
      { id: 'c4ai-aya-expanse-32b', name: 'Aya Expanse 32B (Multilingual)' }
    ]
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    category: 'Permanent Free',
    website: 'https://developers.cloudflare.com/workers-ai',
    signupUrl: 'https://dash.cloudflare.com',
    limitsDescription: '10,000 neurons per day (roughly 1M prompt tokens or 150k output tokens).',
    creditsDescription: 'Permanently free tier for Cloudflare account holders.',
    models: [
      { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B (FP8)' },
      { id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', name: 'DeepSeek R1 Distill Qwen 32B' },
      { id: '@cf/qwen/qwq-32b', name: 'Qwen QwQ 32B (Reasoning)' }
    ]
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    category: 'Permanent Free',
    website: 'https://cloud.cerebras.ai',
    signupUrl: 'https://cloud.cerebras.ai',
    limitsDescription: '5 requests/minute, 30,000 tokens/minute, 1,000,000 tokens/day.',
    creditsDescription: 'Ultra-fast inference platform with free trial keys.',
    models: [
      { id: 'gpt-oss-120b', name: 'GPT OSS 120B' },
      { id: 'gemma-4-31b', name: 'Gemma 4 31B' },
      { id: 'zai-glm-4.7', name: 'GLM 4.7' }
    ]
  },
  {
    id: 'sambanova',
    name: 'SambaNova Cloud',
    category: 'Trial Credits',
    website: 'https://cloud.sambanova.ai',
    signupUrl: 'https://cloud.sambanova.ai',
    limitsDescription: 'Varies by model: typically 5-10 requests/minute, 100-200 requests/day.',
    creditsDescription: 'Provides $5 free credits valid for 3 months.',
    models: [
      { id: 'deepseek-r1', name: 'DeepSeek R1' },
      { id: 'meta-llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct' },
      { id: 'gemma-4-31b-it', name: 'Gemma 4 31B IT' }
    ]
  },
  {
    id: 'hyperbolic',
    name: 'Hyperbolic AI',
    category: 'Trial Credits',
    website: 'https://app.hyperbolic.ai',
    signupUrl: 'https://app.hyperbolic.ai',
    limitsDescription: 'No explicit RPM limit on free tier, capped by total trial credits.',
    creditsDescription: 'Provides $1 free credits upon sign-up.',
    models: [
      { id: 'deepseek-ai/deepseek-r1-0528', name: 'DeepSeek R1 (Hyperbolic)' },
      { id: 'qwen/qwen3-coder-480b-a35b-instruct', name: 'Qwen 3 Coder 480B' },
      { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' }
    ]
  },
  {
    id: 'nebius',
    name: 'Nebius Token Factory',
    category: 'Trial Credits',
    website: 'https://tokenfactory.nebius.com',
    signupUrl: 'https://tokenfactory.nebius.com',
    limitsDescription: 'Capped by trial credit budget.',
    creditsDescription: 'Provides $1 free trial credits.',
    models: [
      { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
      { id: 'deepseek-ai/deepseek-r1', name: 'DeepSeek R1' }
    ]
  },
  {
    id: 'baseten',
    name: 'Baseten',
    category: 'Trial Credits',
    website: 'https://www.baseten.co',
    signupUrl: 'https://app.baseten.co',
    limitsDescription: 'Pay by compute time on active models.',
    creditsDescription: 'Provides $30 free credits upon sign-up.',
    models: [
      { id: 'custom-deploy', name: 'Supports any custom open model deployment' }
    ]
  },
  {
    id: 'scaleway',
    name: 'Scaleway Generative APIs',
    category: 'Trial Credits',
    website: 'https://console.scaleway.com',
    signupUrl: 'https://console.scaleway.com',
    limitsDescription: 'Capped by free token allocation.',
    creditsDescription: 'Offers 1,000,000 free tokens plus 60 minutes of audio transcription.',
    models: [
      { id: 'llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
      { id: 'gemma-3-27b-instruct', name: 'Gemma 3 27B Instruct' },
      { id: 'pixtral-12b-2409', name: 'Pixtral 12B' }
    ]
  }
];

// Helper to look up model occurrences across all free providers
export interface ModelSearchResult {
  id: string;
  name: string;
  providers: { providerId: string; providerName: string; modelId: string; limits: string; website: string }[];
}

export function searchModelsInDb(query: string): ModelSearchResult[] {
  const q = query.toLowerCase().trim();
  const resultMap: { [modelName: string]: ModelSearchResult } = {};

  FREE_PROVIDERS_DB.forEach((prov) => {
    prov.models.forEach((mod) => {
      const matchQuery = 
        mod.id.toLowerCase().includes(q) || 
        mod.name.toLowerCase().includes(q) || 
        prov.name.toLowerCase().includes(q);

      if (!q || matchQuery) {
        // Group by model display name (e.g. "Llama 3.3 70B")
        const groupKey = mod.name.replace(/\s*\(.*?\)\s*/g, '').trim(); // e.g. "Llama 3.3 70B"
        
        if (!resultMap[groupKey]) {
          resultMap[groupKey] = {
            id: mod.id,
            name: groupKey,
            providers: []
          };
        }

        resultMap[groupKey].providers.push({
          providerId: prov.id,
          providerName: prov.name,
          modelId: mod.id,
          limits: prov.limitsDescription,
          website: prov.signupUrl
        });
      }
    });
  });

  return Object.values(resultMap).sort((a, b) => a.name.localeCompare(b.name));
}
