import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

const DEFAULT_PROVIDERS = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://openrouter.ai/api/v1',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Permanent Free',
    website: 'https://openrouter.ai',
    signupUrl: 'https://openrouter.ai/keys',
    creditsDescription: 'Aggregator with dozens of permanently free models (:free suffix).',
    limitsDescription: '20 requests/minute, 50 requests/day (Up to 1000 requests/day with $10 lifetime deposit).',
    models: []
  },
  {
    id: 'gemini',
    name: 'Google AI Studio',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Permanent Free',
    website: 'https://aistudio.google.com',
    signupUrl: 'https://aistudio.google.com',
    creditsDescription: 'Permanently free tier. Data used for training outside UK/EU.',
    limitsDescription: 'Flash: 5 RPM, 20 RPD. Flash-Lite: 15 RPM, 500 RPD. Gemma: 30 RPM, 14,400 RPD.',
    models: []
  },
  {
    id: 'nvidia-nim',
    name: 'NVIDIA NIM',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Permanent Free',
    website: 'https://build.nvidia.com/explore/discover',
    signupUrl: 'https://build.nvidia.com/explore/discover',
    creditsDescription: 'Phone number verification required. Standard open models.',
    limitsDescription: '40 requests/minute.',
    models: []
  },
  {
    id: 'mistral-la-plateforme',
    name: 'Mistral (La Plateforme)',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.mistral.ai/v1',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Permanent Free',
    website: 'https://console.mistral.ai/',
    signupUrl: 'https://console.mistral.ai/',
    creditsDescription: 'Requires phone verification and opting into data training.',
    limitsDescription: 'Set per-model (typically 25k to 20M tokens/minute depending on the model).',
    models: []
  },
  {
    id: 'mistral-codestral',
    name: 'Mistral (Codestral)',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://codestral.mistral.ai/v1',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Permanent Free',
    website: 'https://codestral.mistral.ai/',
    signupUrl: 'https://codestral.mistral.ai/',
    creditsDescription: 'Currently free to use for code generation. Requires phone verification.',
    limitsDescription: '30 requests/minute, 2,000 requests/day.',
    models: []
  },
  {
    id: 'huggingface',
    name: 'HuggingFace Inference',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://router.huggingface.co/v1',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Permanent Free',
    website: 'https://huggingface.co/docs/inference-providers/en/index',
    signupUrl: 'https://huggingface.co/settings/tokens',
    creditsDescription: 'Access to open models smaller than 10GB.',
    limitsDescription: '$0.10/month free tier credits.',
    models: []
  },
  {
    id: 'vercel-gateway',
    name: 'Vercel AI Gateway',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://gateway.ai.vercel.cloud/v1',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Permanent Free',
    website: 'https://vercel.com/docs/ai-gateway',
    signupUrl: 'https://vercel.com/dashboard',
    creditsDescription: 'Routes to various supported provider models.',
    limitsDescription: '$5/month free allotment.',
    models: []
  },
  {
    id: 'kilo-gateway',
    name: 'Kilo Gateway',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.kilo.ai/api/gateway',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Permanent Free',
    website: 'https://kilo.ai/docs/gateway',
    signupUrl: 'https://kilo.ai/docs/gateway',
    creditsDescription: 'Free models work without an account. May use prompts for training.',
    limitsDescription: '200 requests/hour per IP, shared.',
    models: []
  },
  {
    id: 'opencode-zen',
    name: 'OpenCode Zen',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.opencode.ai/v1',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Permanent Free',
    website: 'https://opencode.ai/docs/zen/',
    signupUrl: 'https://opencode.ai/docs/zen/',
    creditsDescription: 'AI gateway with curated open models. May use data for training.',
    limitsDescription: 'Free tiers based on standard usage limits.',
    models: []
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.cerebras.ai/v1',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Permanent Free',
    website: 'https://cloud.cerebras.ai/',
    signupUrl: 'https://cloud.cerebras.ai/',
    creditsDescription: 'Ultra-fast inference platform with free keys.',
    limitsDescription: '5 RPM, 30k TPM, 1M tokens/day.',
    models: []
  },
  {
    id: 'groq',
    name: 'Groq',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.groq.com/openai/v1',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Permanent Free',
    website: 'https://console.groq.com',
    signupUrl: 'https://console.groq.com',
    creditsDescription: 'Permanently free developer key for open models.',
    limitsDescription: 'Llama 3.3 70B: 1,000 RPD / 12k TPM. Llama 3.1 8B: 14,400 RPD / 6k TPM.',
    models: []
  },
  {
    id: 'cohere',
    name: 'Cohere',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.cohere.com/v1',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Permanent Free',
    website: 'https://cohere.com',
    signupUrl: 'https://dashboard.cohere.com/api-keys',
    creditsDescription: 'Free developer key for testing. Common monthly quota.',
    limitsDescription: '20 RPM, 1,000 requests/month.',
    models: []
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Permanent Free',
    website: 'https://developers.cloudflare.com/workers-ai',
    signupUrl: 'https://dash.cloudflare.com',
    creditsDescription: 'Free tier for Cloudflare account holders.',
    limitsDescription: '10,000 neurons/day (approx 1M tokens).',
    models: []
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Trial Credits',
    website: 'https://fireworks.ai/',
    signupUrl: 'https://fireworks.ai/',
    creditsDescription: '$1 free trial credits.',
    limitsDescription: 'Standard trial tier limits.',
    models: []
  },
  {
    id: 'baseten',
    name: 'Baseten',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://bridge.baseten.co/v1',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Trial Credits',
    website: 'https://app.baseten.co/',
    signupUrl: 'https://app.baseten.co/',
    creditsDescription: '$30 free credits for compute deployment.',
    limitsDescription: 'Capped by trial credit budget.',
    models: []
  },
  {
    id: 'nebius',
    name: 'Nebius Studio',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.studio.nebius.ai/v1',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Trial Credits',
    website: 'https://tokenfactory.nebius.com/',
    signupUrl: 'https://tokenfactory.nebius.com/',
    creditsDescription: '$1 free trial credits.',
    limitsDescription: 'Capped by credit budget.',
    models: []
  },
  {
    id: 'novita',
    name: 'Novita AI',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.novita.ai/v1',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Trial Credits',
    website: 'https://novita.ai/',
    signupUrl: 'https://novita.ai/',
    creditsDescription: '$0.5 free credits for 1 year.',
    limitsDescription: 'Capped by credit budget.',
    models: []
  },
  {
    id: 'ai21',
    name: 'AI21 Studio',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.ai21.com/v1',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Trial Credits',
    website: 'https://studio.ai21.com/',
    signupUrl: 'https://studio.ai21.com/',
    creditsDescription: '$10 free credits for 3 months (Jamba models).',
    limitsDescription: 'Capped by trial credits.',
    models: []
  },
  {
    id: 'upstage',
    name: 'Upstage AI',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.upstage.ai/v1',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Trial Credits',
    website: 'https://console.upstage.ai/',
    signupUrl: 'https://console.upstage.ai/',
    creditsDescription: '$10 free credits for 3 months (Solar models).',
    limitsDescription: 'Capped by trial credits.',
    models: []
  },
  {
    id: 'nlp-cloud',
    name: 'NLP Cloud',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.nlpcloud.io/v1',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Trial Credits',
    website: 'https://nlpcloud.com/home',
    signupUrl: 'https://nlpcloud.com/home',
    creditsDescription: '$15 free credits. Requires phone verification.',
    limitsDescription: 'Capped by trial credits.',
    models: []
  },
  {
    id: 'alibaba',
    name: 'Alibaba Cloud Model Studio',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Trial Credits',
    website: 'https://bailian.console.alibabacloud.com/',
    signupUrl: 'https://bailian.console.alibabacloud.com/',
    creditsDescription: '1 million tokens per Qwen model, valid for 90 days (Singapore node).',
    limitsDescription: 'Capped by free token allocation.',
    models: []
  },
  {
    id: 'modal',
    name: 'Modal',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.modal.com/v1',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Trial Credits',
    website: 'https://modal.com',
    signupUrl: 'https://modal.com',
    creditsDescription: '$30/month free starter tier credits.',
    limitsDescription: 'Capped by budget compute hours.',
    models: []
  },
  {
    id: 'inferencenet',
    name: 'Inference.net',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.inference.net/v1',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Trial Credits',
    website: 'https://inference.net',
    signupUrl: 'https://inference.net',
    creditsDescription: '$1 free, or $25 for responding to an email survey.',
    limitsDescription: 'Capped by credit budget.',
    models: []
  },
  {
    id: 'hyperbolic',
    name: 'Hyperbolic AI',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.hyperbolic.xyz/v1',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Trial Credits',
    website: 'https://app.hyperbolic.ai/',
    signupUrl: 'https://app.hyperbolic.ai/',
    creditsDescription: '$1 free trial credits.',
    limitsDescription: 'Capped by credit budget.',
    models: []
  },
  {
    id: 'sambanova',
    name: 'SambaNova Cloud',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.sambanova.ai/v1',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Trial Credits',
    website: 'https://cloud.sambanova.ai/',
    signupUrl: 'https://cloud.sambanova.ai/',
    creditsDescription: '$5 free credits valid for 3 months.',
    limitsDescription: '5-10 requests/minute, 100-200 requests/day.',
    models: []
  },
  {
    id: 'scaleway',
    name: 'Scaleway Generative APIs',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.scaleway.ai/v1',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Trial Credits',
    website: 'https://console.scaleway.com',
    signupUrl: 'https://console.scaleway.com',
    creditsDescription: '1,000,000 free tokens plus 60 minutes of audio transcription.',
    limitsDescription: 'Capped by token usage.',
    models: []
  },
  {
    id: 'openai',
    name: 'OpenAI (Paid)',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Paid Providers',
    website: 'https://openai.com',
    signupUrl: 'https://platform.openai.com',
    creditsDescription: 'Requires paid credit card / balance.',
    limitsDescription: 'Capped by user account tier.',
    models: []
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Paid)',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.anthropic.com/v1',
    proxyEnabled: false,
    proxyUrl: '',
    category: 'Paid Providers',
    website: 'https://anthropic.com',
    signupUrl: 'https://console.anthropic.com',
    creditsDescription: 'Requires paid credit card / balance.',
    limitsDescription: 'Capped by user account tier.',
    models: []
  }
];

const DEFAULT_VIRTUAL_MODELS = [
  {
    id: 'strong-reasoning',
    name: 'Strong Reasoning Pool',
    targets: [
      { providerId: 'groq', modelId: 'deepseek-r1-distill-qwen-32b' },
      { providerId: 'sambanova', modelId: 'deepseek-r1' },
      { providerId: 'openrouter', modelId: 'deepseek/deepseek-r1:free' },
      { providerId: 'openai', modelId: 'gpt-4o' }
    ]
  },
  {
    id: 'coding-agent',
    name: 'Coding Agent Pool',
    targets: [
      { providerId: 'groq', modelId: 'llama-3.3-70b-versatile' },
      { providerId: 'gemini', modelId: 'gemini-3.5-pro' },
      { providerId: 'openrouter', modelId: 'meta-llama/llama-3.3-70b-instruct:free' },
      { providerId: 'anthropic', modelId: 'claude-3-5-sonnet-20241022' }
    ]
  },
  {
    id: 'fast-flash',
    name: 'Fast / Creative Pool',
    targets: [
      { providerId: 'groq', modelId: 'llama-3.1-8b-instant' },
      { providerId: 'gemini', modelId: 'gemini-2.5-flash' },
      { providerId: 'openrouter', modelId: 'google/gemini-2.5-flash:free' },
      { providerId: 'openai', modelId: 'gpt-4o-mini' }
    ]
  }
];

const DEFAULT_CONFIG = {
  globalProxy: '',
  globalProxyEnabled: false,
  providers: DEFAULT_PROVIDERS,
  virtualModels: DEFAULT_VIRTUAL_MODELS,
  aliases: {},
  semanticCacheEnabled: false,
  semanticCacheThreshold: 0.92,
  virtualKeys: [],
  stats: {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    tokensSaved: 0,
    approximateCostSaved: 0.0
  }
};

let memoryLogs = [];

export function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf8');
      const parsed = JSON.parse(data);
      const merged = { ...DEFAULT_CONFIG, ...parsed };
      merged.aliases = parsed.aliases || {};
      merged.semanticCacheEnabled = parsed.semanticCacheEnabled !== undefined ? parsed.semanticCacheEnabled : false;
      merged.semanticCacheThreshold = parsed.semanticCacheThreshold !== undefined ? parsed.semanticCacheThreshold : 0.92;
      merged.virtualKeys = parsed.virtualKeys || [];
      
      DEFAULT_PROVIDERS.forEach(defaultProv => {
        const found = merged.providers.find(p => p.id === defaultProv.id);
        if (!found) {
          merged.providers.push({ ...defaultProv, apiKeys: [] });
        }
      });

      merged.providers.forEach(p => {
        if (!p.apiKeys) {
          p.apiKeys = [];
        }
        if (p.apiKey && p.apiKeys.length === 0) {
          p.apiKeys.push({
            id: 'default',
            key: p.apiKey,
            weight: 1,
            enabled: true
          });
        }
        // Sync API endpoints changes on startup
        if (p.id === 'huggingface' && p.baseUrl === 'https://api-inference.huggingface.co/v1') {
          p.baseUrl = 'https://router.huggingface.co/v1';
        }
        if (p.id === 'kilo-gateway' && p.baseUrl === 'https://api.kilo.ai/v1') {
          p.baseUrl = 'https://api.kilo.ai/api/gateway';
        }
      });
      return merged;
    }
  } catch (err) {
    console.error('Error loading config, falling back to default:', err);
  }
  saveConfig(DEFAULT_CONFIG);
  return DEFAULT_CONFIG;
}

export function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving config:', err);
    return false;
  }
}

export function addLog(level, message, details = '') {
  const logItem = {
    timestamp: new Date().toISOString(),
    level,
    message,
    details
  };
  memoryLogs.unshift(logItem);
  if (memoryLogs.length > 500) {
    memoryLogs.pop();
  }
  console.log(`[${level}] ${message} ${details ? JSON.stringify(details) : ''}`);
}

export function getLogs() {
  return memoryLogs;
}

export function clearLogs() {
  memoryLogs = [];
}
