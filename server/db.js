import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const SESSIONS_PATH = path.join(__dirname, '..', 'chat-sessions.json');

// Explicit aliases are only used when the destination provider advertises the
// translated model (or has not synced a model list yet).
export const PROVIDER_MODEL_ALIASES = {
  openrouter: {
    'deepseek-chat': 'deepseek/deepseek-chat',
    'deepseek-reasoner': 'deepseek/deepseek-r1:free'
  }
};

// Compatibility gate for "does this provider serve this model id" is handled
// by providerSupportsModel() in server/router.js, driven by the optional
// provider.blockedModels config field (data-driven, no hardcoded blocklists).
export function resolveProviderModelId(provider, modelId, explicitModelId = null) {
  const candidate = explicitModelId || modelId;
  const providerType = provider.id.split(':')[0];
  const aliases = PROVIDER_MODEL_ALIASES[providerType] || {};
  const translated = aliases[candidate] || candidate;
  const nativeIds = (provider.models || []).map(model => model.id);

  if (nativeIds.length === 0) return translated;
  if (nativeIds.includes(candidate)) return candidate;
  if (nativeIds.includes(translated)) return translated;
  return null;
}

const DEFAULT_PROVIDERS = [
  {
    id: "openrouter",
    name: "OpenRouter",
    enabled: false,
    apiKey: "",
    baseUrl: "https://openrouter.ai/api/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://openrouter.ai",
    signupUrl: "https://openrouter.ai/keys",
    creditsDescription: "Aggregator with dozens of permanently free models (:free suffix).",
    limitsDescription: "20 requests/minute, 50 requests/day (Up to 1000 requests/day with $10 lifetime deposit).",
    models: [],
    limits: {
      rpm: 20,
      rpd: 1000,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "gemini",
    name: "Google AI Studio",
    enabled: false,
    apiKey: "",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://aistudio.google.com",
    signupUrl: "https://aistudio.google.com",
    creditsDescription: "Permanently free tier. Data used for training outside UK/EU.",
    limitsDescription: "Flash: 5 RPM, 20 RPD. Flash-Lite: 15 RPM, 500 RPD. Gemma: 30 RPM, 14,400 RPD.",
    models: [],
    limits: {
      rpm: 15,
      rpd: 250,
      tpm: 250000,
      tpd: null,
      concurrent: 2
    }
  },
  {
    id: "nvidia-nim",
    name: "NVIDIA NIM",
    enabled: false,
    apiKey: "",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://build.nvidia.com/explore/discover",
    signupUrl: "https://build.nvidia.com/explore/discover",
    creditsDescription: "Phone number verification required. Standard open models.",
    limitsDescription: "40 requests/minute.",
    models: [],
    limits: {
      rpm: 40,
      rpd: 1000,
      tpm: null,
      tpd: null,
      concurrent: 2
    }
  },
  {
    id: "mistral-la-plateforme",
    name: "Mistral (La Plateforme)",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.mistral.ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://console.mistral.ai/",
    signupUrl: "https://console.mistral.ai/",
    creditsDescription: "Requires phone verification and opting into data training.",
    limitsDescription: "Set per-model (typically 25k to 20M tokens/minute depending on the model).",
    models: [],
    limits: {
      rpm: 2,
      rpd: null,
      tpm: 500000,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "mistral-codestral",
    name: "Mistral (Codestral)",
    enabled: false,
    apiKey: "",
    baseUrl: "https://codestral.mistral.ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://codestral.mistral.ai/",
    signupUrl: "https://codestral.mistral.ai/",
    creditsDescription: "Currently free to use for code generation. Requires phone verification.",
    limitsDescription: "30 requests/minute, 2,000 requests/day.",
    models: []
  },
  {
    id: "huggingface",
    name: "HuggingFace Inference",
    enabled: false,
    apiKey: "",
    baseUrl: "https://router.huggingface.co/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://huggingface.co/docs/inference-providers/en/index",
    signupUrl: "https://huggingface.co/settings/tokens",
    creditsDescription: "Access to open models smaller than 10GB.",
    limitsDescription: "$0.10/month free tier credits.",
    models: [],
    limits: {
      rpm: 5,
      rpd: 1000,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "vercel-gateway",
    name: "Vercel AI Gateway",
    enabled: false,
    apiKey: "",
    baseUrl: "https://gateway.ai.vercel.cloud/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://vercel.com/docs/ai-gateway",
    signupUrl: "https://vercel.com/dashboard",
    creditsDescription: "Routes to various supported provider models.",
    limitsDescription: "$5/month free allotment.",
    models: [],
    limits: {
      rpm: 60,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 5
    }
  },
  {
    id: "kilo-gateway",
    name: "Kilo Gateway",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.kilo.ai/api/gateway",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://kilo.ai/docs/gateway",
    signupUrl: "https://kilo.ai/docs/gateway",
    creditsDescription: "Free models work without an account. May use prompts for training.",
    limitsDescription: "200 requests/hour per IP, shared.",
    models: [],
    limits: {
      rpm: 30,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 2
    }
  },
  {
    id: "opencode-zen",
    name: "OpenCode Zen",
    enabled: false,
    apiKey: "",
    baseUrl: "https://opencode.ai/zen/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://opencode.ai/docs/zen/",
    signupUrl: "https://opencode.ai/docs/zen/",
    creditsDescription: "AI gateway with curated open models. May use data for training.",
    limitsDescription: "Free tiers based on standard usage limits.",
    models: [],
    limits: {
      rpm: 100,
      rpd: 100,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "cerebras",
    name: "Cerebras",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.cerebras.ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://cloud.cerebras.ai/",
    signupUrl: "https://cloud.cerebras.ai/",
    creditsDescription: "Ultra-fast inference platform with free keys.",
    limitsDescription: "5 RPM, 30k TPM, 1M tokens/day.",
    models: [],
    limits: {
      rpm: 30,
      rpd: 14400,
      tpm: 60000,
      tpd: 60000,
      concurrent: 1
    }
  },
  {
    id: "groq",
    name: "Groq",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.groq.com/openai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://console.groq.com",
    signupUrl: "https://console.groq.com",
    creditsDescription: "Permanently free developer key for open models.",
    limitsDescription: "Llama 3.3 70B: 1,000 RPD / 12k TPM. Llama 3.1 8B: 14,400 RPD / 6k TPM.",
    models: [],
    limits: {
      rpm: 30,
      rpd: 1000,
      tpm: 6000,
      tpd: 6000,
      concurrent: 1
    }
  },
  {
    id: "cohere",
    name: "Cohere",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.cohere.com/compatibility/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://cohere.com",
    signupUrl: "https://dashboard.cohere.com/api-keys",
    creditsDescription: "Free developer key for testing. Common monthly quota.",
    limitsDescription: "20 RPM, 1,000 requests/month.",
    models: [],
    limits: {
      rpm: 10,
      rpd: 100,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "cloudflare",
    name: "Cloudflare Workers AI",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://developers.cloudflare.com/workers-ai",
    signupUrl: "https://dash.cloudflare.com",
    creditsDescription: "Free tier for Cloudflare account holders.",
    limitsDescription: "10,000 neurons/day (approx 1M tokens).",
    models: [],
    limits: {
      rpm: 1200,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 20
    }
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Trial Credits",
    website: "https://fireworks.ai/",
    signupUrl: "https://fireworks.ai/",
    creditsDescription: "$1 free trial credits.",
    limitsDescription: "Standard trial tier limits.",
    models: [],
    limits: {
      rpm: 60,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 2
    }
  },
  {
    id: "baseten",
    name: "Baseten",
    enabled: false,
    apiKey: "",
    baseUrl: "https://inference.baseten.co/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Trial Credits",
    website: "https://app.baseten.co/",
    signupUrl: "https://app.baseten.co/",
    creditsDescription: "$30 free credits for compute deployment.",
    limitsDescription: "Capped by trial credit budget.",
    models: [],
    limits: {
      rpm: 60,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 2
    }
  },
  {
    id: "nebius",
    name: "Nebius Studio",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.tokenfactory.nebius.com/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Trial Credits",
    website: "https://tokenfactory.nebius.com/",
    signupUrl: "https://tokenfactory.nebius.com/",
    creditsDescription: "$1 free trial credits.",
    limitsDescription: "Capped by credit budget.",
    models: [],
    limits: {
      rpm: 30,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 2
    }
  },
  {
    id: "novita",
    name: "Novita AI",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.novita.ai/openai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Trial Credits",
    website: "https://novita.ai/",
    signupUrl: "https://novita.ai/",
    creditsDescription: "$0.5 free credits for 1 year.",
    limitsDescription: "Capped by credit budget.",
    models: [],
    limits: {
      rpm: 30,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 2
    }
  },
  {
    id: "ai21",
    name: "AI21 Studio",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.ai21.com/studio/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Trial Credits",
    website: "https://studio.ai21.com/",
    signupUrl: "https://studio.ai21.com/",
    creditsDescription: "$10 free credits for 3 months (Jamba models).",
    limitsDescription: "Capped by trial credits.",
    models: [],
    limits: {
      rpm: 10,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "upstage",
    name: "Upstage AI",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.upstage.ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Trial Credits",
    website: "https://console.upstage.ai/",
    signupUrl: "https://console.upstage.ai/",
    creditsDescription: "$10 free credits for 3 months (Solar models).",
    limitsDescription: "Capped by trial credits.",
    models: [],
    limits: {
      rpm: 10,
      rpd: 100,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "nlp-cloud",
    name: "NLP Cloud",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.nlpcloud.io/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Trial Credits",
    website: "https://nlpcloud.com/home",
    signupUrl: "https://nlpcloud.com/home",
    creditsDescription: "$15 free credits. Requires phone verification.",
    limitsDescription: "Capped by trial credits.",
    models: [],
    limits: {
      rpm: 3,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "alibaba",
    name: "Alibaba Cloud Model Studio",
    enabled: false,
    apiKey: "",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Trial Credits",
    website: "https://bailian.console.alibabacloud.com/",
    signupUrl: "https://bailian.console.alibabacloud.com/",
    creditsDescription: "1 million tokens per Qwen model, valid for 90 days (Singapore node).",
    limitsDescription: "Capped by free token allocation.",
    models: [],
    limits: {
      rpm: 30,
      rpd: null,
      tpm: 60000,
      tpd: null,
      concurrent: 2
    }
  },
  {
    id: "modal",
    name: "Modal",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.modal.ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Trial Credits",
    website: "https://modal.com",
    signupUrl: "https://modal.com",
    creditsDescription: "$30/month free starter tier credits.",
    limitsDescription: "Capped by budget compute hours.",
    models: [],
    limits: {
      rpm: 60,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 5
    }
  },
  {
    id: "inferencenet",
    name: "Inference.net",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.inference.net/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Trial Credits",
    website: "https://inference.net",
    signupUrl: "https://inference.net",
    creditsDescription: "$1 free, or $25 for responding to an email survey.",
    limitsDescription: "Capped by credit budget.",
    models: [],
    limits: {
      rpm: 20,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "hyperbolic",
    name: "Hyperbolic AI",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.hyperbolic.xyz/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Trial Credits",
    website: "https://app.hyperbolic.ai/",
    signupUrl: "https://app.hyperbolic.ai/",
    creditsDescription: "$1 free trial credits.",
    limitsDescription: "Capped by credit budget.",
    models: [],
    limits: {
      rpm: 20,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "sambanova",
    name: "SambaNova Cloud",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.sambanova.ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Trial Credits",
    website: "https://cloud.sambanova.ai/",
    signupUrl: "https://cloud.sambanova.ai/",
    creditsDescription: "$5 free credits valid for 3 months.",
    limitsDescription: "5-10 requests/minute, 100-200 requests/day.",
    models: [],
    limits: {
      rpm: 30,
      rpd: null,
      tpm: 60000,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "scaleway",
    name: "Scaleway Generative APIs",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.scaleway.ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Trial Credits",
    website: "https://console.scaleway.com",
    signupUrl: "https://console.scaleway.com",
    creditsDescription: "1,000,000 free tokens plus 60 minutes of audio transcription.",
    limitsDescription: "Capped by token usage.",
    models: [],
    limits: {
      rpm: 100,
      rpd: null,
      tpm: 200000,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "openai",
    name: "OpenAI (Paid)",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Paid Providers",
    website: "https://openai.com",
    signupUrl: "https://platform.openai.com",
    creditsDescription: "Requires paid credit card / balance.",
    limitsDescription: "Capped by user account tier.",
    models: []
  },
  {
    id: "anthropic",
    name: "Anthropic (Paid)",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.anthropic.com/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Paid Providers",
    website: "https://anthropic.com",
    signupUrl: "https://console.anthropic.com",
    creditsDescription: "Requires paid credit card / balance.",
    limitsDescription: "Capped by user account tier.",
    models: []
  },
  {
    id: "reka",
    name: "Reka",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.reka.ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://docs.reka.ai/chat/overview",
    signupUrl: "https://docs.reka.ai/chat/overview",
    creditsDescription: "Use your Reka API key. OmniRoute supports the OpenAI-compatible base URL https://api.reka.ai/v1 and sends both Authorization and X-Api-Key headers for compatibility.",
    limitsDescription: "$10/month recurring free API credits",
    models: [
      {
        id: "reka-flash-3",
        name: "Reka Flash 3"
      },
      {
        id: "reka-flash",
        name: "Reka Flash"
      },
      {
        id: "reka-edge-2603",
        name: "Reka Edge 2603"
      }
    ],
    limits: {
      rpm: 10,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "pioneer",
    name: "Pioneer AI",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.pioneer.ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://pioneer.ai",
    signupUrl: "https://pioneer.ai",
    creditsDescription: "Pioneer AI by Fastino Labs. Free $75 usage credits, no credit card required. Use API key auth with a pio_sk_... key. Only open-tier models (Qwen3, Llama, Gemma, SmolLM) work directly — gated models (Claude/GPT/Gemini) require prior fine-tuning via the Pioneer platform.",
    limitsDescription: "$75 free usage credits — no credit card required",
    models: [
      {
        id: "Qwen/Qwen3-32B",
        name: "Qwen3 32B"
      },
      {
        id: "Qwen/Qwen3.6-27B",
        name: "Qwen3.6 27B"
      },
      {
        id: "Qwen/Qwen3.5-9B",
        name: "Qwen3.5 9B"
      },
      {
        id: "Qwen/Qwen3-8B",
        name: "Qwen3 8B"
      },
      {
        id: "Qwen/Qwen3-4B-Base",
        name: "Qwen3 4B Base"
      },
      {
        id: "Qwen/Qwen3-1.7B-Base",
        name: "Qwen3 1.7B Base"
      },
      {
        id: "meta-llama/Llama-3.1-8B-Instruct",
        name: "Llama 3.1 8B Instruct"
      },
      {
        id: "meta-llama/Llama-3.2-1B-Instruct",
        name: "Llama 3.2 1B Instruct"
      },
      {
        id: "google/gemma-3-4b-pt",
        name: "Gemma 3 4B (Pretrained)"
      },
      {
        id: "HuggingFaceTB/SmolLM3-3B-Base",
        name: "SmolLM3 3B Base"
      }
    ],
    limits: {
      rpm: 20,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "blackbox",
    name: "Blackbox AI",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.blackbox.ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://blackbox.ai",
    signupUrl: "https://blackbox.ai",
    creditsDescription: "Free tier access.",
    limitsDescription: "Limited free access is available through Blackbox; model availability and account limits apply",
    models: [
      {
        id: "claude-fable-5",
        name: "Claude Fable 5"
      },
      {
        id: "claude-opus-4.8",
        name: "Claude Opus 4.8"
      },
      {
        id: "claude-sonnet-5",
        name: "Claude Sonnet 5"
      },
      {
        id: "claude-sonnet-4.6",
        name: "Claude Sonnet 4.6"
      },
      {
        id: "gpt-5.5",
        name: "GPT-5.5"
      },
      {
        id: "gpt-5.4-pro",
        name: "GPT-5.4 Pro"
      },
      {
        id: "gpt-5.4",
        name: "GPT-5.4"
      },
      {
        id: "gpt-5.3-codex",
        name: "GPT-5.3 Codex"
      },
      {
        id: "gpt-5.4-nano",
        name: "GPT-5.4 Nano"
      },
      {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash"
      },
      {
        id: "grok-4.3",
        name: "Grok 4.3"
      }
    ],
    limits: {
      rpm: 15,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "morph",
    name: "Morph",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.morphllm.com/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://morphllm.com",
    signupUrl: "https://morphllm.com",
    creditsDescription: "Free tier access.",
    limitsDescription: "Free tier: 250K credits/month, $0",
    models: [],
    limits: {
      rpm: 20,
      rpd: 200,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "liquid",
    name: "Liquid AI",
    enabled: false,
    apiKey: "",
    baseUrl: "https://inference.liquid.ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://liquid.ai",
    signupUrl: "https://liquid.ai",
    creditsDescription: "Get API key at liquid.ai",
    limitsDescription: "Free LFM2.5-1.2B-Thinking and LFM2.5-1.2B-Instruct models. MIT spinoff, hybrid architecture.",
    models: [
      {
        id: "liquid-lfm-40b",
        name: "Liquid LFM 40B"
      }
    ],
    limits: {
      rpm: 15,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "inception",
    name: "Inception",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.inceptionlabs.ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://docs.inceptionlabs.ai",
    signupUrl: "https://docs.inceptionlabs.ai",
    creditsDescription: "Free tier access.",
    limitsDescription: "10M free tokens on signup, no credit card required.",
    models: [
      {
        id: "mercury-2",
        name: "Mercury 2"
      }
    ],
    limits: {
      rpm: 20,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "openvecta",
    name: "OpenVecta",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.openvecta.com/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Trial Credits",
    website: "https://openvecta.com",
    signupUrl: "https://openvecta.com",
    creditsDescription: "Free tier access.",
    limitsDescription: "Free credits on signup for OpenAI-compatible inference across LLMs, embeddings, and reasoning models",
    models: [
      {
        id: "glm-4.7-flash",
        name: "GLM 4.7 Flash"
      },
      {
        id: "claude-sonnet-4.6",
        name: "Claude Sonnet 4.6"
      },
      {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash"
      },
      {
        id: "gpt-oss-120b",
        name: "GPT OSS 120B"
      },
      {
        id: "gemma-4-31b",
        name: "Gemma 4 31B"
      },
      {
        id: "kimi-k2.6",
        name: "Kimi K2.6"
      },
      {
        id: "llama-3.3-70b-instruct",
        name: "Llama 3.3 70B Instruct"
      },
      {
        id: "llama-4-maverick",
        name: "Llama 4 Maverick"
      },
      {
        id: "nemotron-3-super-120b",
        name: "Nemotron 3 Super 120B"
      }
    ],
    limits: {
      rpm: 20,
      rpd: 200,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "poolside",
    name: "Poolside",
    enabled: false,
    apiKey: "",
    baseUrl: "https://inference.poolside.ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://poolside.ai",
    signupUrl: "https://poolside.ai",
    creditsDescription: "Free tier access.",
    limitsDescription: "Laguna S 2.1 and XS 2.1 are free during Preview; no public numeric quota is published.",
    models: [
      {
        id: "poolside/laguna-xs-2.1",
        name: "Laguna XS 2.1"
      },
      {
        id: "poolside/laguna-s-2.1",
        name: "Laguna S 2.1"
      }
    ],
    limits: {
      rpm: 10,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "siliconflow",
    name: "SiliconFlow",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.siliconflow.com/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Trial Credits",
    website: "https://cloud.siliconflow.com",
    signupUrl: "https://cloud.siliconflow.com",
    creditsDescription: "Free tier access.",
    limitsDescription: "$1 free credits plus currently listed $0 models after identity verification; availability and limits may change",
    models: [
      {
        id: "deepseek-ai/DeepSeek-V3.2",
        name: "DeepSeek V3.2"
      },
      {
        id: "deepseek-ai/DeepSeek-V3.2-Exp",
        name: "DeepSeek V3.2 Exp"
      },
      {
        id: "deepseek-ai/DeepSeek-V3.1",
        name: "DeepSeek V3.1"
      },
      {
        id: "deepseek-ai/DeepSeek-V3.1-Terminus",
        name: "DeepSeek V3.1 Terminus"
      },
      {
        id: "deepseek-ai/DeepSeek-V3",
        name: "DeepSeek V3"
      },
      {
        id: "deepseek-ai/DeepSeek-R1",
        name: "DeepSeek R1"
      },
      {
        id: "deepseek-ai/deepseek-vl2",
        name: "DeepSeek VL2"
      },
      {
        id: "nex-agi/DeepSeek-V3.1-Nex-N1",
        name: "DeepSeek V3.1 Nex N1"
      },
      {
        id: "Qwen/Qwen3.6-35B-A3B",
        name: "Qwen 3.6 35B A3B"
      },
      {
        id: "Qwen/Qwen3.6-27B",
        name: "Qwen 3.6 27B"
      },
      {
        id: "Qwen/Qwen3.5-397B-A17B",
        name: "Qwen 3.5 397B A17B"
      },
      {
        id: "Qwen/Qwen3.5-122B-A10B",
        name: "Qwen 3.5 122B A10B"
      },
      {
        id: "Qwen/Qwen3.5-35B-A3B",
        name: "Qwen 3.5 35B A3B"
      },
      {
        id: "Qwen/Qwen3.5-27B",
        name: "Qwen 3.5 27B"
      },
      {
        id: "Qwen/Qwen3.5-9B",
        name: "Qwen 3.5 9B"
      },
      {
        id: "Qwen/Qwen3-Next-80B-A3B-Instruct",
        name: "Qwen3 Next 80B Instruct"
      },
      {
        id: "Qwen/Qwen3-Next-80B-A3B-Thinking",
        name: "Qwen3 Next 80B Thinking"
      },
      {
        id: "Qwen/Qwen3-235B-A22B",
        name: "Qwen3 235B A22B"
      },
      {
        id: "Qwen/Qwen3-235B-A22B-Instruct-2507",
        name: "Qwen3 235B A22B Instruct"
      },
      {
        id: "Qwen/Qwen3-235B-A22B-Thinking-2507",
        name: "Qwen3 235B A22B Thinking"
      },
      {
        id: "Qwen/Qwen3-32B",
        name: "Qwen3 32B"
      },
      {
        id: "Qwen/Qwen3-30B-A3B-Instruct-2507",
        name: "Qwen3 30B A3B Instruct"
      },
      {
        id: "Qwen/Qwen3-30B-A3B-Thinking-2507",
        name: "Qwen3 30B A3B Thinking"
      },
      {
        id: "Qwen/Qwen3-14B",
        name: "Qwen3 14B"
      },
      {
        id: "Qwen/Qwen3-8B",
        name: "Qwen3 8B"
      },
      {
        id: "Qwen/Qwen3-Coder-480B-A35B-Instruct",
        name: "Qwen3 Coder 480B"
      },
      {
        id: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
        name: "Qwen3 Coder 30B"
      },
      {
        id: "Qwen/Qwen3-Omni-30B-A3B-Instruct",
        name: "Qwen3 Omni 30B Instruct"
      },
      {
        id: "Qwen/Qwen3-Omni-30B-A3B-Thinking",
        name: "Qwen3 Omni 30B Thinking"
      },
      {
        id: "Qwen/Qwen3-Omni-30B-A3B-Captioner",
        name: "Qwen3 Omni 30B Captioner"
      },
      {
        id: "Qwen/Qwen2.5-72B-Instruct",
        name: "Qwen 2.5 72B"
      },
      {
        id: "Qwen/Qwen2.5-72B-Instruct-128K",
        name: "Qwen 2.5 72B 128K"
      },
      {
        id: "Qwen/Qwen2.5-32B-Instruct",
        name: "Qwen 2.5 32B"
      },
      {
        id: "Qwen/Qwen2.5-14B-Instruct",
        name: "Qwen 2.5 14B"
      },
      {
        id: "Qwen/Qwen2.5-7B-Instruct",
        name: "Qwen 2.5 7B"
      },
      {
        id: "Qwen/Qwen2.5-VL-7B-Instruct",
        name: "Qwen 2.5 VL 7B"
      },
      {
        id: "zai-org/GLM-5.1",
        name: "GLM 5.1"
      },
      {
        id: "zai-org/GLM-5",
        name: "GLM 5"
      },
      {
        id: "zai-org/GLM-5V-Turbo",
        name: "GLM 5V Turbo"
      },
      {
        id: "zai-org/GLM-4.7",
        name: "GLM 4.7"
      },
      {
        id: "zai-org/GLM-4.6",
        name: "GLM 4.6"
      },
      {
        id: "zai-org/GLM-4.6V",
        name: "GLM 4.6V"
      },
      {
        id: "zai-org/GLM-4.5",
        name: "GLM 4.5"
      },
      {
        id: "zai-org/GLM-4.5-Air",
        name: "GLM 4.5 Air"
      },
      {
        id: "zai-org/GLM-4.5V",
        name: "GLM 4.5V"
      },
      {
        id: "THUDM/GLM-4-32B-0414",
        name: "GLM 4 32B"
      },
      {
        id: "THUDM/GLM-4-9B-0414",
        name: "GLM 4 9B"
      },
      {
        id: "THUDM/GLM-Z1-32B-0414",
        name: "GLM Z1 32B"
      },
      {
        id: "THUDM/GLM-Z1-9B-0414",
        name: "GLM Z1 9B"
      },
      {
        id: "moonshotai/Kimi-K2.6",
        name: "Kimi K2.6"
      },
      {
        id: "moonshotai/Kimi-K2.5",
        name: "Kimi K2.5"
      },
      {
        id: "moonshotai/Kimi-K2-Instruct",
        name: "Kimi K2 Instruct"
      },
      {
        id: "moonshotai/Kimi-K2-Instruct-0905",
        name: "Kimi K2 Instruct 0905"
      },
      {
        id: "moonshotai/Kimi-K2-Thinking",
        name: "Kimi K2 Thinking"
      },
      {
        id: "openai/gpt-oss-120b",
        name: "GPT OSS 120B"
      },
      {
        id: "openai/gpt-oss-20b",
        name: "GPT OSS 20B"
      },
      {
        id: "baidu/ERNIE-4.5-300B-A47B",
        name: "ERNIE 4.5 300B"
      },
      {
        id: "tencent/Hunyuan-A13B-Instruct",
        name: "Hunyuan A13B"
      },
      {
        id: "tencent/Hunyuan-MT-7B",
        name: "Hunyuan MT 7B"
      },
      {
        id: "tencent/Hy3-preview",
        name: "Hunyuan Hy3 Preview"
      },
      {
        id: "meta-llama/Meta-Llama-3.1-8B-Instruct",
        name: "Llama 3.1 8B"
      },
      {
        id: "MiniMaxAI/MiniMax-M2.5",
        name: "MiniMax M2.5"
      },
      {
        id: "MiniMaxAI/MiniMax-M2.1",
        name: "MiniMax M2.1"
      },
      {
        id: "inclusionAI/Ling-flash-2.0",
        name: "Ling Flash 2.0"
      },
      {
        id: "inclusionAI/Ling-mini-2.0",
        name: "Ling Mini 2.0"
      },
      {
        id: "inclusionAI/Ring-flash-2.0",
        name: "Ring Flash 2.0"
      },
      {
        id: "google/gemma-4-31B-it",
        name: "Gemma 4 31B"
      },
      {
        id: "google/gemma-4-26B-A4B-it",
        name: "Gemma 4 26B"
      },
      {
        id: "ByteDance-Seed/Seed-OSS-36B-Instruct",
        name: "Seed OSS 36B"
      }
    ],
    limits: {
      rpm: 30,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 2
    }
  },
  {
    id: "deepinfra",
    name: "DeepInfra",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.deepinfra.com/v1/openai",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Trial Credits",
    website: "https://deepinfra.com",
    signupUrl: "https://deepinfra.com",
    creditsDescription: "Free tier access.",
    limitsDescription: "Free signup credits for API testing and model exploration",
    models: [],
    limits: {
      rpm: 30,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 200
    }
  },
  {
    id: "nscale",
    name: "nScale",
    enabled: false,
    apiKey: "",
    baseUrl: "https://inference.api.nscale.com/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Trial Credits",
    website: "https://nscale.com",
    signupUrl: "https://nscale.com",
    creditsDescription: "Free tier access.",
    limitsDescription: "$5 free credits on signup for inference testing",
    models: [],
    limits: {
      rpm: 20,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "friendliai",
    name: "FriendliAI",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.friendli.ai/serverless/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://friendli.ai",
    signupUrl: "https://friendli.ai",
    creditsDescription: "Free tier access.",
    limitsDescription: "Free tier for serverless inference — no credit card required",
    models: [],
    limits: {
      rpm: 20,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "bytez",
    name: "Bytez",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.bytez.com/models/v2/openai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Trial Credits",
    website: "https://bytez.com",
    signupUrl: "https://bytez.com",
    creditsDescription: "Free tier access.",
    limitsDescription: "$1 free credits, refreshes every 4 weeks",
    models: [],
    limits: {
      rpm: 10,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "monsterapi",
    name: "MonsterAPI",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.monsterapi.ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Trial Credits",
    website: "https://monsterapi.ai",
    signupUrl: "https://monsterapi.ai",
    creditsDescription: "Get API key at monsterapi.ai",
    limitsDescription: "One-time signup trial credits for decentralized GPU inference (no recurring free plan). No credit card required.",
    models: [
      {
        id: "meta-llama/Meta-Llama-3.1-8B-Instruct",
        name: "Llama 3.1 8B Instruct"
      },
      {
        id: "meta-llama/Llama-3.3-70B-Instruct",
        name: "Llama 3.3 70B Instruct"
      }
    ],
    limits: {
      rpm: 10,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "modelscope",
    name: "ModelScope",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api-inference.modelscope.cn/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://modelscope.cn",
    signupUrl: "https://modelscope.cn",
    creditsDescription: "Free tier access.",
    limitsDescription: "Free tier via ModelScope API-Inference — Alibaba account required.",
    models: [],
    limits: {
      rpm: 30,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 2
    }
  },
  {
    id: "byteplus",
    name: "BytePlus ModelArk",
    enabled: false,
    apiKey: "",
    baseUrl: "https://ark.ap-southeast.bytepluses.com/api/v3",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://console.byteplus.com/ark",
    signupUrl: "https://console.byteplus.com/ark",
    creditsDescription: "Free credits for new accounts. Seed 2.0, Kimi K2 Thinking, GLM 4.7, GPT-OSS-120B available.",
    limitsDescription: "Available free models.",
    models: [
      {
        id: "seed-2.0",
        name: "Seed 2.0"
      },
      {
        id: "kimi-k2-thinking",
        name: "Kimi K2 Thinking"
      },
      {
        id: "glm-4.7",
        name: "GLM 4.7"
      },
      {
        id: "gpt-oss-120b",
        name: "GPT-OSS-120B"
      }
    ],
    limits: {
      rpm: 30,
      rpd: null,
      tpm: 60000,
      tpd: null,
      concurrent: 2
    }
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.deepseek.com/responses",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Trial Credits",
    website: "https://platform.deepseek.com",
    signupUrl: "https://platform.deepseek.com",
    creditsDescription: "Free tier access.",
    limitsDescription: "5M free tokens on signup - no credit card required",
    models: [
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro (0813)"
      },
      {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash (0731)"
      }
    ],
    limits: {
      rpm: 60,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 2
    }
  },
  {
    id: "longcat",
    name: "LongCat AI",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.longcat.chat/openai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Trial Credits",
    website: "https://longcat.chat/platform/docs",
    signupUrl: "https://longcat.chat/platform/docs",
    creditsDescription: "Free tier access.",
    limitsDescription: "Free: one-time 10M-token grant after account signup + KYC verification (LongCat-2.0). One-time only — not a recurring daily/monthly allowance.",
    models: [
      {
        id: "LongCat-2.0",
        name: "LongCat 2.0 (10M tok free 🆓)"
      }
    ],
    limits: {
      rpm: 60,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 2
    }
  },
  {
    id: "baidu",
    name: "Baidu (ERNIE)",
    enabled: false,
    apiKey: "",
    baseUrl: "https://qianfan.baidubce.com/v2",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://ernie.baidu.com/",
    signupUrl: "https://ernie.baidu.com/",
    creditsDescription: "Get API key at console.bce.baidu.com",
    limitsDescription: "Free ERNIE Speed/Lite models. China",
    models: [
      {
        id: "ernie-5.1",
        name: "ERNIE 5.1"
      },
      {
        id: "ernie-5.0",
        name: "ERNIE 5.0"
      },
      {
        id: "ernie-x1.1",
        name: "ERNIE X1.1"
      },
      {
        id: "ernie-4.5-turbo-128k",
        name: "ERNIE 4.5 Turbo 128K"
      },
      {
        id: "ernie-4.5-turbo-32k",
        name: "ERNIE 4.5 Turbo 32K"
      },
      {
        id: "ernie-4.5-turbo-vl",
        name: "ERNIE 4.5 Turbo VL"
      },
      {
        id: "ernie-4.5-21b-a3b",
        name: "ERNIE 4.5 21B A3B"
      },
      {
        id: "ernie-4.5-0.3b",
        name: "ERNIE 4.5 0.3B"
      },
      {
        id: "ernie-4.0-8k",
        name: "ERNIE 4.0 8K"
      },
      {
        id: "ernie-4.0-turbo-128k",
        name: "ERNIE 4.0 Turbo 128K"
      },
      {
        id: "ernie-4.0-turbo-8k",
        name: "ERNIE 4.0 Turbo 8K"
      },
      {
        id: "ernie-3.5-8k",
        name: "ERNIE 3.5 8K"
      },
      {
        id: "ernie-speed-128k",
        name: "ERNIE Speed 128K"
      },
      {
        id: "ernie-speed-8k",
        name: "ERNIE Speed 8K"
      },
      {
        id: "ernie-lite-8k",
        name: "ERNIE Lite 8K"
      },
      {
        id: "ernie-tiny-8k",
        name: "ERNIE Tiny 8K"
      }
    ],
    limits: {
      rpm: 60,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 2
    }
  },
  {
    id: "tencent",
    name: "Tencent Hunyuan",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://hunyuan.tencent.com",
    signupUrl: "https://hunyuan.tencent.com",
    creditsDescription: "Get API key at console.cloud.tencent.com",
    limitsDescription: "Free Hunyuan Lite models. WeChat ecosystem.",
    models: [
      {
        id: "hunyuan-turbos-latest",
        name: "Hunyuan TurboS Latest"
      },
      {
        id: "hunyuan-t1-latest",
        name: "Hunyuan T1 Latest"
      },
      {
        id: "hunyuan-pro",
        name: "Hunyuan Pro"
      },
      {
        id: "hunyuan-vision",
        name: "Hunyuan Vision"
      },
      {
        id: "hunyuan-functioncall",
        name: "Hunyuan FunctionCall"
      },
      {
        id: "hunyuan-lite",
        name: "Hunyuan Lite"
      }
    ],
    limits: {
      rpm: 60,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 2
    }
  },
  {
    id: "iflytek",
    name: "iFlytek Spark",
    enabled: false,
    apiKey: "",
    baseUrl: "https://spark-api-open.xf-yun.com/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://xinghuo.xfyun.cn",
    signupUrl: "https://xinghuo.xfyun.cn",
    creditsDescription: "Get API key at console.xfyun.cn",
    limitsDescription: "Spark Lite is free (2 QPS rate-limited), but iFlytek ToS §2.4(3) prohibits programmatic extraction and requires Chinese real-name auth — use with caution.",
    models: [
      {
        id: "4.0Ultra",
        name: "Spark 4.0 Ultra"
      },
      {
        id: "generalv3.5",
        name: "Spark Max (V3.5)"
      },
      {
        id: "max-32k",
        name: "Spark Max 32K"
      },
      {
        id: "generalv3",
        name: "Spark Pro"
      },
      {
        id: "pro-128k",
        name: "Spark Pro 128K"
      },
      {
        id: "lite",
        name: "Spark Lite"
      }
    ],
    limits: {
      rpm: 60,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 2
    }
  },
  {
    id: "baichuan",
    name: "Baichuan",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.baichuan-ai.com/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://www.baichuan-ai.com/",
    signupUrl: "https://www.baichuan-ai.com/",
    creditsDescription: "Get API key at platform.baichuan-ai.com",
    limitsDescription: "Free Baichuan models. Popular Chinese LLM startup.",
    models: [
      {
        id: "Baichuan4-Turbo",
        name: "Baichuan 4 Turbo"
      },
      {
        id: "Baichuan4-Air",
        name: "Baichuan 4 Air"
      },
      {
        id: "Baichuan4",
        name: "Baichuan 4"
      },
      {
        id: "Baichuan3-Turbo",
        name: "Baichuan 3 Turbo"
      },
      {
        id: "Baichuan3-Turbo-128k",
        name: "Baichuan 3 Turbo 128k"
      }
    ],
    limits: {
      rpm: 30,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "stepfun",
    name: "StepFun",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.stepfun.com/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://stepfun.com",
    signupUrl: "https://stepfun.com",
    creditsDescription: "Get API key at platform.stepfun.com",
    limitsDescription: "Free Step-2 models. Chinese AI company.",
    models: [
      {
        id: "step-3.7-flash",
        name: "Step 3.7 Flash"
      },
      {
        id: "step-3.5-flash",
        name: "Step 3.5 Flash"
      },
      {
        id: "step-3.5-flash-2603",
        name: "Step 3.5 Flash 2603"
      },
      {
        id: "step-1o-turbo-vision",
        name: "Step 1o Turbo Vision"
      },
      {
        id: "step-1v",
        name: "Step 1V"
      }
    ],
    limits: {
      rpm: 30,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "coze",
    name: "Coze",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.coze.com/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://coze.com",
    signupUrl: "https://coze.com",
    creditsDescription: "Get API key at coze.com/open/api",
    limitsDescription: "Free ByteDance agent platform. Bot building + LLM access.",
    models: [
      {
        id: "claude-3-7-sonnet-20250514",
        name: "Claude 3.7 Sonnet"
      }
    ],
    limits: {
      rpm: 20,
      rpd: 500,
      tpm: null,
      tpd: null,
      concurrent: 2
    }
  },
  {
    id: "doubao",
    name: "Doubao",
    enabled: false,
    apiKey: "",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://doubao.com",
    signupUrl: "https://doubao.com",
    creditsDescription: "Get API key at console.volcengine.com",
    limitsDescription: "Free Doubao models. ByteDance",
    models: [
      {
        id: "doubao-seed-2-0-pro-260215",
        name: "Doubao Seed 2.0 Pro"
      },
      {
        id: "doubao-seed-2-0-lite-260215",
        name: "Doubao Seed 2.0 Lite"
      },
      {
        id: "doubao-seed-2-0-mini-260215",
        name: "Doubao Seed 2.0 Mini"
      },
      {
        id: "doubao-seed-2-0-code-preview-260215",
        name: "Doubao Seed 2.0 Code"
      },
      {
        id: "doubao-seed-1-8-251228",
        name: "Doubao Seed 1.8"
      },
      {
        id: "doubao-seed-1-6-251015",
        name: "Doubao Seed 1.6"
      },
      {
        id: "doubao-seed-1-6-flash-250828",
        name: "Doubao Seed 1.6 Flash"
      },
      {
        id: "doubao-1-5-pro-32k-250115",
        name: "Doubao 1.5 Pro 32K"
      },
      {
        id: "doubao-pro-32k",
        name: "Doubao Pro 32K"
      }
    ],
    limits: {
      rpm: 60,
      rpd: null,
      tpm: 60000,
      tpd: null,
      concurrent: 2
    }
  },
  {
    id: "sensenova",
    name: "SenseNova",
    enabled: false,
    apiKey: "",
    baseUrl: "https://token.sensenova.cn/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Trial Credits",
    website: "https://platform.sensenova.cn",
    signupUrl: "https://platform.sensenova.cn",
    creditsDescription: "Get API key at platform.sensenova.cn",
    limitsDescription: "Free SenseTime models. Computer vision leader.",
    models: [
      {
        id: "sensenova-6.7-flash-lite",
        name: "SenseNova 6.7 Flash-Lite"
      },
      {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash"
      },
      {
        id: "glm-5.2",
        name: "GLM 5.2"
      }
    ],
    limits: {
      rpm: 30,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "sparkdesk",
    name: "SparkDesk",
    enabled: false,
    apiKey: "",
    baseUrl: "https://spark-api-open.xf-yun.com/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://xinghuo.xfyun.cn",
    signupUrl: "https://xinghuo.xfyun.cn",
    creditsDescription: "Get API key at console.xfyun.cn",
    limitsDescription: "Spark Lite free (alias for iflytek), but ToS restricts to personal/non-commercial use and prohibits relaying access to third parties — use with caution.",
    models: [
      {
        id: "4.0Ultra",
        name: "Spark 4.0 Ultra"
      },
      {
        id: "generalv3",
        name: "Spark Pro"
      },
      {
        id: "pro-128k",
        name: "Spark Pro 128K"
      },
      {
        id: "lite",
        name: "Spark Lite"
      }
    ],
    limits: {
      rpm: 30,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "hcnsec",
    name: "Huancheng Public API",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.hcnsec.cn/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Trial Credits",
    website: "https://api.hcnsec.cn",
    signupUrl: "https://api.hcnsec.cn",
    creditsDescription: "Get API key at api.hcnsec.cn",
    limitsDescription: "Xinjiang Huancheng Cybersecurity public LLM API platform: free credits with daily check-ins.",
    models: [],
    limits: {
      rpm: 10,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "agnes",
    name: "Agnes AI",
    enabled: false,
    apiKey: "",
    baseUrl: "https://apihub.agnes-ai.com/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://agnes-ai.com",
    signupUrl: "https://agnes-ai.com",
    creditsDescription: "Get API key at agnes-ai.com",
    limitsDescription: "Permanently free API - no credit card required.",
    models: [
      {
        id: "agnes-1.5-flash",
        name: "Agnes 1.5 Flash"
      },
      {
        id: "agnes-2.0-flash",
        name: "Agnes 2.0 Flash"
      },
      {
        id: "agnes-2.5-flash",
        name: "Agnes 2.5 Flash"
      }
    ],
    limits: {
      rpm: 10,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "sealion",
    name: "SEA-LION",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.sea-lion.ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://sea-lion.ai",
    signupUrl: "https://sea-lion.ai",
    creditsDescription: "Sign in at sea-lion.ai with Google (no card, no region wall), create an API key, then paste it here.",
    limitsDescription: "Permanently free at 10 RPM — AI Singapore",
    models: [
      {
        id: "aisingapore/Llama-SEA-LION-v3.5-70B-R",
        name: "Llama SEA-LION v3.5 70B R"
      },
      {
        id: "aisingapore/Llama-SEA-LION-v3-70B-IT",
        name: "Llama SEA-LION v3 70B IT"
      },
      {
        id: "aisingapore/Gemma-SEA-LION-v4-27B-IT",
        name: "Gemma SEA-LION v4 27B IT"
      },
      {
        id: "aisingapore/Qwen-SEA-LION-v4.5-27B-IT",
        name: "Qwen SEA-LION v4.5 27B IT"
      },
      {
        id: "aisingapore/Qwen-SEA-LION-v4-32B-IT",
        name: "Qwen SEA-LION v4 32B IT"
      }
    ],
    limits: {
      rpm: 20,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "internlm",
    name: "InternLM (Intern-S1)",
    enabled: false,
    apiKey: "",
    baseUrl: "https://chat.intern-ai.org.cn/api/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://internlm.intern-ai.org.cn/",
    signupUrl: "https://internlm.intern-ai.org.cn/",
    creditsDescription: "Free tier access.",
    limitsDescription: "Free monthly quota ~1M input / 3M output tokens (~10 RPM)",
    models: [
      {
        id: "intern-s1-pro",
        name: "Intern-S1 Pro"
      },
      {
        id: "intern-s1",
        name: "Intern-S1"
      },
      {
        id: "intern-s1-mini",
        name: "Intern-S1 Mini"
      },
      {
        id: "internvl3.5-latest",
        name: "InternVL3.5 Latest"
      },
      {
        id: "intern-latest",
        name: "Intern Latest"
      }
    ],
    limits: {
      rpm: 30,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 2
    }
  },
  {
    id: "sarvam",
    name: "Sarvam AI",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.sarvam.ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Trial Credits",
    website: "https://docs.sarvam.ai",
    signupUrl: "https://docs.sarvam.ai",
    creditsDescription: "Free tier access.",
    limitsDescription: "₹1,000 in free signup credits — never expire",
    models: [
      {
        id: "sarvam-105b",
        name: "Sarvam 105B"
      },
      {
        id: "sarvam-30b",
        name: "Sarvam 30B"
      }
    ],
    limits: {
      rpm: 10,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "typhoon",
    name: "Typhoon",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.opentyphoon.ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://docs.opentyphoon.ai",
    signupUrl: "https://docs.opentyphoon.ai",
    creditsDescription: "Free tier access.",
    limitsDescription: "Free API key with a 5 req/s and 200 req/m rate limit.",
    models: [
      {
        id: "typhoon-v2.5-30b-a3b-instruct",
        name: "Typhoon v2.5 30B A3B Instruct"
      }
    ],
    limits: {
      rpm: 20,
      rpd: 20,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "freebuff",
    name: "Freebuff",
    enabled: false,
    apiKey: "",
    baseUrl: "https://www.codebuff.com/api/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://freebuff.com",
    signupUrl: "https://freebuff.com",
    creditsDescription: "Enter Freebuff / Codebuff Auth Token (obtained via CLI login or automated harvester).",
    limitsDescription: "Free Codebuff / Freebuff AI models.",
    models: [
      {
        id: "deepseek/deepseek-v4-flash",
        name: "DeepSeek V4 Flash"
      },
      {
        id: "deepseek/deepseek-v4-pro",
        name: "DeepSeek V4 Pro"
      },
      {
        id: "openai/gpt-5.6-luna",
        name: "GPT-5.6 Luna"
      },
      {
        id: "minimax/minimax-m3",
        name: "MiniMax M3"
      },
      {
        id: "mimo/mimo-v2.5",
        name: "MiMo v2.5"
      },
      {
        id: "z-ai/glm-5.2",
        name: "GLM 5.2"
      },
      {
        id: "crof/kimi-k3-eco",
        name: "Kimi K3 Eco"
      },
      {
        id: "anthropic/claude-fable-5",
        name: "Claude Fable 5"
      },
      {
        id: "meta/muse-spark-1.2-contributor",
        name: "Meta Muse Spark 1.2 Contributor"
      }
    ],
    limits: {
      rpm: 30,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "agentrouter",
    name: "AgentRouter",
    enabled: false,
    apiKey: "",
    baseUrl: "https://agentrouter.org/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://agentrouter.org",
    signupUrl: "https://agentrouter.org",
    creditsDescription: "Free tier access.",
    limitsDescription: "$200 free credits on signup - multi-model routing gateway",
    models: [
      {
        id: "claude-opus-4-8",
        name: "Claude Opus 4.8"
      },
      {
        id: "claude-opus-5",
        name: "Claude Opus 5"
      },
      {
        id: "gpt-5.6-sol",
        name: "GPT-5.6 Sol"
      }
    ],
    limits: {
      rpm: 30,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 2
    }
  },
  {
    id: "unorouter",
    name: "UnoRouter",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.unorouter.com/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://unorouter.ai",
    signupUrl: "https://unorouter.ai",
    creditsDescription: "Free tier access.",
    limitsDescription: "Models with the :free suffix do not debit balance; limit is 1 request/minute per free model per user.",
    models: [],
    limits: {
      rpm: 20,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "requesty",
    name: "Requesty",
    enabled: false,
    apiKey: "",
    baseUrl: "https://router.requesty.ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://requesty.ai",
    signupUrl: "https://requesty.ai",
    creditsDescription: "Free tier access.",
    limitsDescription: "Free tier ~200 requests/day - multi-model routing gateway (300+ models)",
    models: [],
    limits: {
      rpm: 30,
      rpd: 1000,
      tpm: null,
      tpd: null,
      concurrent: 2
    }
  },
  {
    id: "fastrouter",
    name: "FastRouter",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.fastrouter.ai/api/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://fastrouter.ai",
    signupUrl: "https://fastrouter.ai",
    creditsDescription: "Free tier access.",
    limitsDescription: "Models with the :free suffix allow 10 requests/day per organization and model; availability may change.",
    models: [],
    limits: {
      rpm: 20,
      rpd: 10,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "anyapi",
    name: "AnyAPI AI",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.anyapi.ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://anyapi.ai",
    signupUrl: "https://anyapi.ai",
    creditsDescription: "Free tier access.",
    limitsDescription: "Free plan: 100,000 ANY Tokens/day and 100 RPM for eligible Free/Basic models; no credit card required.",
    models: [],
    limits: {
      rpm: 20,
      rpd: 200,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "electronhub",
    name: "Electron Hub",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.electronhub.ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://www.electronhub.ai",
    signupUrl: "https://www.electronhub.ai",
    creditsDescription: "Free tier access.",
    limitsDescription: "Free plan: 5 RPM, $0.25 weekly credits and 10 Neutrinos/day for :free models; family budgets also apply.",
    models: [],
    limits: {
      rpm: 20,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "llmgateway",
    name: "LLM Gateway",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.llmgateway.io/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://llmgateway.io",
    signupUrl: "https://llmgateway.io",
    creditsDescription: "Free tier access.",
    limitsDescription: "Hosted Free plan: free-priced models are limited to 5 requests per 10 minutes when the account has no credits.",
    models: [],
    limits: {
      rpm: 0,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "literouter",
    name: "LiteRouter",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.literouter.com/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://literouter.com",
    signupUrl: "https://literouter.com",
    creditsDescription: "Free tier access.",
    limitsDescription: "Free model variants use the :free suffix; daily credit limits vary by model and free input is capped at 5,000 tokens.",
    models: [],
    limits: {
      rpm: 20,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "mixlayer",
    name: "Mixlayer",
    enabled: false,
    apiKey: "",
    baseUrl: "https://models.mixlayer.ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://www.mixlayer.com",
    signupUrl: "https://www.mixlayer.com",
    creditsDescription: "Free tier access.",
    limitsDescription: "The qwen/qwen3.5-4b-free model is free for prototyping and rate-limited; no fixed public RPM or daily quota is confirmed.",
    models: [
      {
        id: "qwen/qwen3.5-4b-free",
        name: "Qwen 3.5 4B (free)"
      }
    ],
    limits: {
      rpm: 20,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "speka",
    name: "Speka AI",
    enabled: false,
    apiKey: "",
    baseUrl: "https://speka.me/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://speka.me",
    signupUrl: "https://speka.me",
    creditsDescription: "Free tier access.",
    limitsDescription: "Free plan: $1 monthly usage, 10 RPM, one API key and access to open models and the playground; no card required.",
    models: [],
    limits: {
      rpm: 10,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "tokenreply",
    name: "TokenReply",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.tokenreply.com/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://www.tokenreply.com",
    signupUrl: "https://www.tokenreply.com",
    creditsDescription: "Free tier access.",
    limitsDescription: "Free-tagged models have model- and campaign-specific daily limits; no fixed global free quota is published.",
    models: [],
    limits: {
      rpm: 20,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "dxnt",
    name: "DXNT / DX Token",
    enabled: false,
    apiKey: "",
    baseUrl: "https://www.dxnt.com/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://www.dxnt.com",
    signupUrl: "https://www.dxnt.com",
    creditsDescription: "Free tier access.",
    limitsDescription: "Free accounts are documented at 100 calls/day; the quota may increase through invitations and can vary by account.",
    models: [],
    limits: {
      rpm: 20,
      rpd: 100,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "ofoxai",
    name: "OfoxAI",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.ofox.ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://ofox.ai",
    signupUrl: "https://ofox.ai",
    creditsDescription: "Free tier access.",
    limitsDescription: "The current catalog advertises 10+ free models without a public numeric quota; review upstream provenance, retention and training terms before production use.",
    models: [],
    limits: {
      rpm: 20,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "zerolimitai",
    name: "ZeroLimitAI",
    enabled: false,
    apiKey: "",
    baseUrl: "https://www.zerolimitai.com/api/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://www.zerolimitai.com",
    signupUrl: "https://www.zerolimitai.com",
    creditsDescription: "Free tier access.",
    limitsDescription: "Temporary free trial is advertised, but official pages conflict between 3 and 7 days; a 100-calls/day claim is not treated as permanent.",
    models: [],
    limits: {
      rpm: 20,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "chatanywhere",
    name: "ChatAnywhere",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.chatanywhere.org/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://chatanywhere.tech",
    signupUrl: "https://chatanywhere.tech",
    creditsDescription: "Free tier access.",
    limitsDescription: "Personal, educational or research use only: public documentation cites 10,000 points/day and 200 requests/day per IP/key; do not use for commercial traffic.",
    models: [],
    limits: {
      rpm: 20,
      rpd: 200,
      tpm: 2000,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "helyxai",
    name: "Helyx AI",
    enabled: false,
    apiKey: "",
    baseUrl: "https://helyxai.space/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://helyxai.space",
    signupUrl: "https://helyxai.space",
    creditsDescription: "Free tier access.",
    limitsDescription: "Operational Free plan documents 100,000 tokens/day; the site",
    models: [],
    limits: {
      rpm: 20,
      rpd: null,
      tpm: null,
      tpd: 100000,
      concurrent: 1
    }
  },
  {
    id: "auriko",
    name: "Auriko",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.auriko.ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://www.auriko.ai",
    signupUrl: "https://www.auriko.ai",
    creditsDescription: "Free tier access.",
    limitsDescription: "Free plan publishes 1,000 Platform RPM and 10,000 BYOK RPM. Platform inference still passes through provider cost; this is not a free-token pool or unlimited free inference.",
    models: [],
    limits: {
      rpm: 20,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "freeinference",
    name: "FreeInference",
    enabled: false,
    apiKey: "",
    baseUrl: "https://freeinference.org/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://freeinference.org",
    signupUrl: "https://freeinference.org",
    creditsDescription: "Free tier access.",
    limitsDescription: "Free research access without a card; non-Harvard applicants require manual approval and no numeric quota is publicly guaranteed.",
    models: [],
    limits: {
      rpm: 20,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "dgrid",
    name: "DGrid",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.dgrid.ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://dgrid.ai",
    signupUrl: "https://dgrid.ai",
    creditsDescription: "Free tier access.",
    limitsDescription: "DGrid Free Models Router: 10 requests/minute and 100 requests/day. ",
    models: [
      {
        id: "dgridai/free",
        name: "DGrid Free Models Router"
      }
    ],
    limits: {
      rpm: 20,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "bazaarlink",
    name: "BazaarLink",
    enabled: false,
    apiKey: "",
    baseUrl: "https://bazaarlink.ai/api/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://bazaarlink.ai",
    signupUrl: "https://bazaarlink.ai",
    creditsDescription: "Use your BazaarLink API key (starts with sk-bl-) in Authorization: Bearer <key>. OpenAI SDK works with base URL https://bazaarlink.ai/api/v1. Models use provider/model-name format.",
    limitsDescription: "Free tier: 4M tokens/day per account with auto:free routing — zero-cost inference, no credit card required.",
    models: [
      {
        id: "auto:free",
        name: "Auto Free (Zero Cost)"
      },
      {
        id: "claude-opus-4.7",
        name: "Claude Opus 4.7"
      },
      {
        id: "claude-sonnet-4.6",
        name: "Claude Sonnet 4.6"
      },
      {
        id: "claude-haiku-4.5",
        name: "Claude Haiku 4.5"
      },
      {
        id: "gpt-5.5",
        name: "GPT-5.5"
      },
      {
        id: "gpt-5.4",
        name: "GPT-5.4"
      },
      {
        id: "gpt-5.4-mini",
        name: "GPT-5.4 Mini"
      },
      {
        id: "gpt-5.4-nano",
        name: "GPT-5.4 Nano"
      },
      {
        id: "grok-4.3",
        name: "Grok 4.3"
      },
      {
        id: "grok-4.20",
        name: "Grok 4.20"
      },
      {
        id: "gemini-3.1-pro-preview",
        name: "Gemini 3.1 Pro"
      },
      {
        id: "gemini-3-flash-preview",
        name: "Gemini 3 Flash"
      },
      {
        id: "gemini-3.1-flash-lite-preview",
        name: "Gemini 3.1 Flash Lite"
      },
      {
        id: "gemma-4-31b-it",
        name: "Gemma 4 31B"
      },
      {
        id: "gemma-4-26b-a4b-it",
        name: "Gemma 4 26B A4B"
      },
      {
        id: "deepseek-v3.2",
        name: "DeepSeek V3.2"
      },
      {
        id: "kimi-k2.6",
        name: "Kimi K2.6"
      },
      {
        id: "kimi-k2.5",
        name: "Kimi K2.5"
      },
      {
        id: "glm-5.1",
        name: "GLM 5.1"
      },
      {
        id: "glm-5",
        name: "GLM 5"
      },
      {
        id: "mimo-v2.5-pro",
        name: "MiMo-V2.5-Pro"
      },
      {
        id: "mimo-v2.5",
        name: "MiMo-V2.5"
      },
      {
        id: "minimax-m3",
        name: "MiniMax M3"
      },
      {
        id: "minimax-m2.7",
        name: "MiniMax M2.7"
      },
      {
        id: "minimax-m2.5",
        name: "MiniMax M2.5"
      },
      {
        id: "llama-4-maverick",
        name: "Llama 4 Maverick"
      },
      {
        id: "llama-4-scout",
        name: "Llama 4 Scout"
      },
      {
        id: "llama-3.3-70b-instruct",
        name: "Llama 3.3 70B"
      },
      {
        id: "qwen3.6-plus",
        name: "Qwen 3.6 Plus"
      },
      {
        id: "mistral-large-2512",
        name: "Mistral Large 3"
      },
      {
        id: "mistral-medium-3.1",
        name: "Mistral Medium 3.1"
      },
      {
        id: "mistral-small-2603",
        name: "Mistral Small 4"
      },
      {
        id: "nemotron-3-super-120b-a12b",
        name: "Nemotron 3 Super"
      }
    ],
    limits: {
      rpm: 20,
      rpd: 150,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "dahl",
    name: "Dahl",
    enabled: false,
    apiKey: "",
    baseUrl: "https://inference.dahl.global/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://inference.dahl.global",
    signupUrl: "https://inference.dahl.global",
    creditsDescription: "Click ",
    limitsDescription: "Free — MiniMax M2.7, Kimi K2.6. Click ",
    models: [
      {
        id: "MiniMaxAI/MiniMax-M2.7",
        name: "MiniMax M2.7"
      },
      {
        id: "moonshotai/Kimi-K2.6",
        name: "Kimi K2.6"
      }
    ],
    limits: {
      rpm: 20,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "uncloseai",
    name: "UncloseAI",
    enabled: false,
    apiKey: "",
    baseUrl: "https://hermes.ai.unturf.com/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://uncloseai.com",
    signupUrl: "https://uncloseai.com",
    creditsDescription: "No auth required. API accepts any non-empty string as key for identification. If older built-in models return 404, use Available Models → Import from /models or Auto-Sync; verified live model: solidrust/Hermes-3-Llama-3.1-8B-AWQ.",
    limitsDescription: "Free forever — no signup, no credit card. OpenAI-compatible endpoints.",
    models: [
      {
        id: "adamo1139/Hermes-3-Llama-3.1-8B-FP8-Dynamic",
        name: "Hermes 3 Llama 3.1 8B (🆓 Free)"
      },
      {
        id: "qwen3.6:27b",
        name: "Qwen3 Coder 27B (🆓 Free)"
      },
      {
        id: "gemma4:31b",
        name: "Gemma 4 31B (🆓 Free)"
      }
    ],
    limits: {
      rpm: 20,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "hackclub",
    name: "Hackclub AI",
    enabled: false,
    apiKey: "",
    baseUrl: "https://ai.hackclub.com/proxy/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://ai.hackclub.com",
    signupUrl: "https://ai.hackclub.com",
    creditsDescription: "Sign in with your Hack Club account at ai.hackclub.com.",
    limitsDescription: "Free AI for Hack Club members — 30+ models, no credit card.",
    models: [
      {
        id: "meta-llama/llama-3.3-70b-instruct",
        name: "Llama 3.3 70B"
      },
      {
        id: "mistralai/mistral-7b-instruct",
        name: "Mistral 7B"
      },
      {
        id: "deepseek-ai/deepseek-coder-33b",
        name: "DeepSeek Coder 33B"
      }
    ],
    limits: {
      rpm: 10,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "freetheai",
    name: "FreeTheAi",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.freetheai.xyz/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://freetheai.xyz",
    signupUrl: "https://freetheai.xyz",
    creditsDescription: "Join the FreeTheAi Discord to get your free API key.",
    limitsDescription: "Free OpenAI-compatible gateway — sign up via Discord for an API key.",
    models: [
      {
        id: "gpt-4o-mini",
        name: "GPT-4o Mini"
      },
      {
        id: "llama-3.3-70b-instruct",
        name: "Llama 3.3 70B"
      },
      {
        id: "deepseek-chat",
        name: "DeepSeek Chat"
      }
    ],
    limits: {
      rpm: 20,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "llm7",
    name: "LLM7.io",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.llm7.io/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://llm7.io",
    signupUrl: "https://llm7.io",
    creditsDescription: "Use any non-empty key (for example ",
    limitsDescription: "No signup required - 2 req/s, 20 RPM, 100 req/hr free tier",
    models: [
      {
        id: "gpt-4o-mini-2024-07-18",
        name: "GPT-4o mini (LLM7)"
      },
      {
        id: "gpt-4.1-nano-2025-04-14",
        name: "GPT-4.1 nano (LLM7)"
      },
      {
        id: "deepseek-r1-0528",
        name: "DeepSeek R1 (LLM7)"
      },
      {
        id: "qwen2.5-coder-32b-instruct",
        name: "Qwen2.5 Coder 32B (LLM7)"
      }
    ],
    limits: {
      rpm: 60,
      rpd: null,
      tpm: null,
      tpd: 1000000,
      concurrent: 2
    }
  },
  {
    id: "bluesminds",
    name: "BluesMinds",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.bluesminds.com/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://www.bluesminds.com",
    signupUrl: "https://www.bluesminds.com",
    creditsDescription: "Free tier access.",
    limitsDescription: "Free daily pi credits — supports 200+ models including GPT-4o, GPT-4.1, Claude Sonnet 4.5, Gemini 2.0 Flash, DeepSeek V4, Qwen, Kimi K2",
    models: [
      {
        id: "gpt-4o",
        name: "GPT-4o"
      },
      {
        id: "gpt-4o-mini",
        name: "GPT-4o Mini"
      },
      {
        id: "gpt-4.1",
        name: "GPT-4.1"
      },
      {
        id: "gpt-4.1-mini",
        name: "GPT-4.1 Mini"
      },
      {
        id: "gpt-4.1-nano",
        name: "GPT-4.1 Nano"
      },
      {
        id: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5"
      },
      {
        id: "claude-haiku-4-5",
        name: "Claude Haiku 4.5"
      },
      {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash"
      },
      {
        id: "gemini-2.0-flash-exp",
        name: "Gemini 2.0 Flash (Exp)"
      },
      {
        id: "deepseek-reasoner",
        name: "DeepSeek Reasoner"
      },
      {
        id: "deepseek-chat",
        name: "DeepSeek Chat"
      },
      {
        id: "qwen-plus",
        name: "Qwen Plus"
      },
      {
        id: "qwen-turbo",
        name: "Qwen Turbo"
      },
      {
        id: "kimi-k2",
        name: "Kimi K2"
      },
      {
        id: "kimi-k2-thinking",
        name: "Kimi K2 Thinking"
      },
      {
        id: "glm-4.7",
        name: "GLM 4.7"
      },
      {
        id: "glm-4-flash",
        name: "GLM 4 Flash"
      },
      {
        id: "minimax-m2.5",
        name: "MiniMax M2.5"
      },
      {
        id: "claude-opus-4-5",
        name: "Claude Opus 4.5 (VIP)"
      },
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro (VIP)"
      },
      {
        id: "grok-3",
        name: "Grok-3 (VIP)"
      },
      {
        id: "qwen-max",
        name: "Qwen Max (VIP)"
      }
    ],
    limits: {
      rpm: 20,
      rpd: 300,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "zenmux",
    name: "ZenMux",
    enabled: false,
    apiKey: "",
    baseUrl: "https://zenmux.ai/api/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://zenmux.ai",
    signupUrl: "https://zenmux.ai",
    creditsDescription: "Use your ZenMux API key in Authorization: Bearer <key>. ZenMux is fully OpenAI-compatible. Base URL: https://zenmux.ai/api/v1.",
    limitsDescription: "Free tier includes access to Gemini 3 Flash, DeepSeek V3.2, Grok 4.1 Fast, Mistral Large, and more. Get your API key at https://zenmux.ai.",
    models: [
      {
        id: "google/gemini-3.1-pro-preview",
        name: "Gemini 3.1 Pro Preview (ZenMux)"
      },
      {
        id: "google/gemini-3-flash-preview",
        name: "Gemini 3 Flash Preview (ZenMux)"
      },
      {
        id: "openai/gpt-5",
        name: "GPT-5 (ZenMux)"
      },
      {
        id: "anthropic/claude-sonnet-4.5",
        name: "Claude Sonnet 4.5 (ZenMux)"
      },
      {
        id: "anthropic/claude-opus-4.5",
        name: "Claude Opus 4.5 (ZenMux)"
      },
      {
        id: "deepseek/deepseek-chat",
        name: "DeepSeek V3.2 Chat (ZenMux)"
      },
      {
        id: "x-ai/grok-4.1-fast",
        name: "Grok 4.1 Fast (ZenMux)"
      },
      {
        id: "mistralai/mistral-large-2512",
        name: "Mistral Large 2512 (ZenMux)"
      },
      {
        id: "z-ai/glm-4.6v-flash",
        name: "GLM 4.6V Flash (ZenMux)"
      }
    ],
    limits: {
      rpm: 20,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "openadapter",
    name: "OpenAdapter",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.openadapter.in/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://openadapter.dev",
    signupUrl: "https://openadapter.dev",
    creditsDescription: "Use your OpenAdapter API key in Authorization: Bearer sk-cv-<key>. Fully OpenAI-compatible. API base URL: https://api.openadapter.in/v1.",
    limitsDescription: "Free tier with a generous quota and no credit card — 15+ open-source models with daily quota. Get your API key at https://dashboard.openadapter.in.",
    models: [
      {
        id: "glm-4.7",
        name: "GLM 4.7 (OpenAdapter)"
      }
    ],
    limits: {
      rpm: 20,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "tokenrouter",
    name: "TokenRouter",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.tokenrouter.com/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://tokenrouter.com",
    signupUrl: "https://tokenrouter.com",
    creditsDescription: "Use your TokenRouter API key in Authorization: Bearer <key>. Fully OpenAI-compatible. API base URL: https://api.tokenrouter.com/v1.",
    limitsDescription: "Free tier includes the MiniMax 3 model. Get your API key at https://tokenrouter.com.",
    models: [
      {
        id: "minimax-3",
        name: "MiniMax 3 (free, TokenRouter)"
      },
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro (TokenRouter)"
      },
      {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash (TokenRouter)"
      }
    ],
    limits: {
      rpm: 20,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "navy",
    name: "NavyAI",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.navy/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://api.navy",
    signupUrl: "https://api.navy",
    creditsDescription: "Create a free API key from the NavyAI dashboard, then paste it here as a Bearer token.",
    limitsDescription: "Free plan is one shared 150K tokens/day pool at 20 RPM. Each model carries a ",
    models: [
      {
        id: "llama-3.3-70b-instruct",
        name: "Llama 3.3 70B Instruct"
      },
      {
        id: "gemma-4-31b-it",
        name: "Gemma 4 31B IT"
      },
      {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash"
      },
      {
        id: "deepseek-chat",
        name: "DeepSeek Chat"
      },
      {
        id: "mistral-small-latest",
        name: "Mistral Small"
      },
      {
        id: "llama-4-scout",
        name: "Llama 4 Scout"
      }
    ],
    limits: {
      rpm: 20,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "ainative",
    name: "AINative Studio",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.ainative.studio/api/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://ainative.studio",
    signupUrl: "https://ainative.studio",
    creditsDescription: "Create a free API key at ainative.studio (no card), then paste it here as a Bearer token.",
    limitsDescription: "Free tier ~10M tokens/month (claimed) across Qwen3, Llama 4, DeepSeek R1 and more.",
    models: [
      {
        id: "qwen3-235b-cerebras",
        name: "Qwen3 235B (Cerebras)"
      },
      {
        id: "qwen3-32b",
        name: "Qwen3 32B"
      },
      {
        id: "qwen3-14b",
        name: "Qwen3 14B"
      },
      {
        id: "qwen3-8b",
        name: "Qwen3 8B"
      },
      {
        id: "llama-4-maverick",
        name: "Llama 4 Maverick"
      },
      {
        id: "llama3.1-8b-cerebras",
        name: "Llama 3.1 8B (Cerebras)"
      },
      {
        id: "deepseek-r1",
        name: "DeepSeek R1"
      },
      {
        id: "nous-coder",
        name: "Nous Coder"
      },
      {
        id: "gemini-flash",
        name: "Gemini Flash"
      }
    ],
    limits: {
      rpm: 20,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "aion",
    name: "Aion Labs",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.aionlabs.ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://www.aionlabs.ai",
    signupUrl: "https://www.aionlabs.ai",
    creditsDescription: "Create a free API key at aionlabs.ai (no card), then paste it here as a Bearer token.",
    limitsDescription: "Free tier ~20k tokens/day across the Aion reasoning models.",
    models: [
      {
        id: "aion-labs/aion-3.0",
        name: "Aion 3.0"
      },
      {
        id: "aion-labs/aion-3.0-mini",
        name: "Aion 3.0 Mini"
      },
      {
        id: "aion-labs/aion-2.5",
        name: "Aion 2.5"
      },
      {
        id: "aion-labs/aion-2.0",
        name: "Aion 2.0"
      },
      {
        id: "aion-labs/aion-rp-llama-3.1-8b",
        name: "Aion RP Llama 3.1 8B"
      }
    ],
    limits: {
      rpm: 15,
      rpd: null,
      tpm: null,
      tpd: 20000,
      concurrent: 1
    }
  },
  {
    id: "routeway",
    name: "Routeway",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.routeway.ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://routeway.ai",
    signupUrl: "https://routeway.ai",
    creditsDescription: "Create a free API key at routeway.ai, then paste it here as a Bearer token.",
    limitsDescription: "Free models (:free suffix) at ~5 RPM / 200 RPD across Llama, Nemotron, Step and Laguna.",
    models: [
      {
        id: "llama-3.3-70b-instruct:free",
        name: "Llama 3.3 70B Instruct (free)"
      },
      {
        id: "nemotron-3-nano-30b-a3b:free",
        name: "Nemotron 3 Nano 30B (free)"
      },
      {
        id: "nemotron-nano-9b-v2:free",
        name: "Nemotron Nano 9B v2 (free)"
      },
      {
        id: "step-3.7-flash:free",
        name: "Step 3.7 Flash (free)"
      },
      {
        id: "step-3.5-flash:free",
        name: "Step 3.5 Flash (free)"
      },
      {
        id: "laguna-m.1:free",
        name: "Laguna M.1 (free)"
      },
      {
        id: "laguna-xs.2:free",
        name: "Laguna XS.2 (free)"
      },
      {
        id: "llama-3.2-3b-instruct:free",
        name: "Llama 3.2 3B Instruct (free)"
      }
    ],
    limits: {
      rpm: 20,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "nara",
    name: "NaraRouter",
    enabled: false,
    apiKey: "",
    baseUrl: "https://router.bynara.id/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://bynara.id",
    signupUrl: "https://bynara.id",
    creditsDescription: "Get a free API key via NaraRouter",
    limitsDescription: "Free tier is a shared 5M tokens/day pool; some models are gated behind credit/plan.",
    models: [
      {
        id: "tencent-hy3",
        name: "Tencent Hy3"
      },
      {
        id: "mistral-large",
        name: "Mistral Large"
      },
      {
        id: "mistral-medium-3-5",
        name: "Mistral Medium 3.5"
      }
    ],
    limits: {
      rpm: 15,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "vertex",
    name: "Vertex AI",
    enabled: false,
    apiKey: "",
    baseUrl: "https://us-central1-aiplatform.googleapis.com/v1/projects",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://cloud.google.com/vertex-ai",
    signupUrl: "https://cloud.google.com/vertex-ai",
    creditsDescription: "Provide Service Account JSON or OAuth access_token",
    limitsDescription: "Available free models.",
    models: [
      {
        id: "gemini-3.1-pro-preview",
        name: "Gemini 3.1 Pro Preview (Vertex)"
      },
      {
        id: "gemini-3.1-flash-lite",
        name: "Gemini 3.1 Flash Lite (Vertex)"
      },
      {
        id: "gemini-3-flash-preview",
        name: "Gemini 3 Flash Preview (Vertex)"
      },
      {
        id: "gemma-4-31b-it",
        name: "Gemma 4 31B (Vertex)"
      },
      {
        id: "DeepSeek-V4-Flash",
        name: "DeepSeek V4 Flash (Vertex Partner)"
      },
      {
        id: "DeepSeek-V4-Pro",
        name: "DeepSeek V4 Pro (Vertex Partner)"
      },
      {
        id: "Qwen3.6-35B-A3B",
        name: "Qwen3.6 35B A3B (Vertex Partner)"
      },
      {
        id: "GLM-5.1-FP8",
        name: "GLM-5.1 (Vertex Partner)"
      },
      {
        id: "claude-opus-4-7",
        name: "Claude Opus 4.7 (Vertex)"
      },
      {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6 (Vertex)"
      }
    ],
    limits: {
      rpm: 60,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 5
    }
  },
  {
    id: "nlpcloud",
    name: "NLP Cloud",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.nlpcloud.io/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://docs.nlpcloud.com",
    signupUrl: "https://docs.nlpcloud.com",
    creditsDescription: "Use your NLP Cloud API key in Authorization: Token <key>. OmniRoute targets the chatbot endpoint on https://api.nlpcloud.io/v1/gpu/<model>/chatbot by default.",
    limitsDescription: "Trial credits for new accounts",
    models: [
      {
        id: "chatdolphin",
        name: "ChatDolphin"
      },
      {
        id: "dolphin",
        name: "Dolphin"
      },
      {
        id: "finetuned-llama-3-70b",
        name: "Fine-tuned LLaMA 3.3 70B"
      },
      {
        id: "llama-3-1-405b",
        name: "LLaMA 3.1 405B"
      },
      {
        id: "llama-3-8b-instruct",
        name: "Llama 3 8B"
      }
    ],
    limits: {
      rpm: 3,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "pollinations",
    name: "Pollinations AI",
    enabled: false,
    apiKey: "",
    baseUrl: "https://gen.pollinations.ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://pollinations.ai",
    signupUrl: "https://pollinations.ai",
    creditsDescription: "Anonymous/keyless access to the documented free models is best-effort. Local v3.8.50 verification (2026-07-31) returned 401 via OmniRoute and Cloudflare 1010 on direct upstream probes from the same network. Premium models still require a Pollinations API key from enter.pollinations.ai.",
    limitsDescription: "Free keyless tier: openai, openai-fast, openai-large, qwen-coder, mistral, deepseek, grok, gemini-flash-lite-3.1, perplexity-fast, perplexity-reasoning. Premium models (claude, gemini, midijourney) require a Pollinations API key from enter.pollinations.ai.",
    models: [
      {
        id: "openai",
        name: "OpenAI (Pollinations)"
      },
      {
        id: "openai-fast",
        name: "OpenAI Fast (Pollinations)"
      },
      {
        id: "openai-large",
        name: "OpenAI Large (Pollinations)"
      },
      {
        id: "qwen-coder",
        name: "Qwen Coder (Pollinations)"
      },
      {
        id: "mistral",
        name: "Mistral (Pollinations)"
      },
      {
        id: "gemini",
        name: "Gemini (Pollinations)"
      },
      {
        id: "gemini-flash-lite-3.1",
        name: "Gemini Flash Lite 3.1 (Pollinations)"
      },
      {
        id: "gemini-fast",
        name: "Gemini Fast (Pollinations)"
      },
      {
        id: "deepseek",
        name: "DeepSeek (Pollinations)"
      },
      {
        id: "grok",
        name: "Grok (Pollinations)"
      },
      {
        id: "grok-large",
        name: "Grok Large (Pollinations)"
      },
      {
        id: "gemini-search",
        name: "Gemini Search (Pollinations)"
      },
      {
        id: "midijourney",
        name: "Midijourney (Pollinations)"
      },
      {
        id: "midijourney-large",
        name: "Midijourney Large (Pollinations)"
      },
      {
        id: "claude-fast",
        name: "Claude Fast (Pollinations)"
      },
      {
        id: "claude",
        name: "Claude (Pollinations)"
      },
      {
        id: "claude-large",
        name: "Claude Large (Pollinations)"
      },
      {
        id: "perplexity-fast",
        name: "Perplexity Fast (Pollinations)"
      },
      {
        id: "perplexity-reasoning",
        name: "Perplexity Reasoning (Pollinations)"
      },
      {
        id: "kimi",
        name: "Kimi (Pollinations)"
      },
      {
        id: "gemini-large",
        name: "Gemini Large (Pollinations)"
      },
      {
        id: "nova-fast",
        name: "Nova Fast (Pollinations)"
      },
      {
        id: "nova",
        name: "Nova (Pollinations)"
      },
      {
        id: "glm",
        name: "GLM (Pollinations)"
      },
      {
        id: "minimax",
        name: "MiniMax (Pollinations)"
      },
      {
        id: "mistral-large",
        name: "Mistral Large (Pollinations)"
      },
      {
        id: "polly",
        name: "Polly (Pollinations)"
      },
      {
        id: "qwen-coder-large",
        name: "Qwen Coder Large (Pollinations)"
      },
      {
        id: "qwen-large",
        name: "Qwen Large (Pollinations)"
      },
      {
        id: "qwen-vision",
        name: "Qwen Vision (Pollinations)"
      },
      {
        id: "qwen-safety",
        name: "Qwen Safety (Pollinations)"
      }
    ],
    limits: {
      rpm: 30,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 2
    }
  },
  {
    id: "magnific",
    name: "Magnific",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.magnific.com/v1/ai/mystic",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://www.magnific.com",
    signupUrl: "https://www.magnific.com",
    creditsDescription: "Get an API key at magnific.com/user/api-keys (header x-magnific-api-key). Legacy Freepik developer keys still work.",
    limitsDescription: "One-time ~€5 API credit for new accounts; pay-per-use afterward.",
    models: [
      {
        id: "realism",
        name: "Mystic Realism"
      },
      {
        id: "fluid",
        name: "Mystic Fluid (Imagen 3)"
      },
      {
        id: "zen",
        name: "Mystic Zen"
      },
      {
        id: "flexible",
        name: "Mystic Flexible"
      },
      {
        id: "super_real",
        name: "Mystic Super Real"
      },
      {
        id: "editorial_portraits",
        name: "Mystic Editorial Portraits"
      }
    ],
    limits: {
      rpm: 5,
      rpd: null,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  },
  {
    id: "dify",
    name: "Dify",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.dify.ai/v1",
    proxyEnabled: false,
    proxyUrl: "",
    category: "Permanent Free",
    website: "https://dify.ai",
    signupUrl: "https://dify.ai",
    creditsDescription: "Get API key from your Dify instance.",
    limitsDescription: "Free open-source AI app builder + RAG platform.",
    models: [
      {
        id: "auto",
        name: "Auto"
      }
    ],
    limits: {
      rpm: 20,
      rpd: 200,
      tpm: null,
      tpd: null,
      concurrent: 1
    }
  }
];

const DEFAULT_VIRTUAL_MODELS = [
  {
    "id": "strong-reasoning",
    "name": "Strong Reasoning Pool",
    "strategy": "priority",
    "config": {
      "maxRetries": 1,
      "timeoutMs": 30000,
      "cooldownMs": 60000,
      "fallbackOn5xx": true,
      "fallbackOn429": true,
      "fallbackOn403": true
    },
    "targets": [
      {
        "providerId": "groq",
        "modelId": "deepseek-r1-distill-qwen-32b"
      },
      {
        "providerId": "sambanova",
        "modelId": "deepseek-r1"
      },
      {
        "providerId": "openrouter",
        "modelId": "deepseek/deepseek-r1:free"
      },
      {
        "providerId": "openai",
        "modelId": "gpt-4o"
      }
    ]
  },
  {
    "id": "coding-agent",
    "name": "Coding Agent Pool",
    "strategy": "priority",
    "config": {
      "maxRetries": 1,
      "timeoutMs": 30000,
      "cooldownMs": 60000,
      "fallbackOn5xx": true,
      "fallbackOn429": true,
      "fallbackOn403": true
    },
    "targets": [
      {
        "providerId": "groq",
        "modelId": "llama-3.3-70b-versatile"
      },
      {
        "providerId": "gemini",
        "modelId": "gemini-2.5-flash"
      },
      {
        "providerId": "openrouter",
        "modelId": "meta-llama/llama-3.3-70b-instruct:free"
      },
      {
        "providerId": "anthropic",
        "modelId": "claude-3-5-sonnet-20241022"
      }
    ]
  },
  {
    "id": "fast-flash",
    "name": "Fast / Creative Pool",
    "strategy": "priority",
    "config": {
      "maxRetries": 1,
      "timeoutMs": 30000,
      "cooldownMs": 60000,
      "fallbackOn5xx": true,
      "fallbackOn429": true,
      "fallbackOn403": true
    },
    "targets": [
      {
        "providerId": "groq",
        "modelId": "llama-3.1-8b-instant"
      },
      {
        "providerId": "gemini",
        "modelId": "gemini-2.5-flash"
      },
      {
        "providerId": "openrouter",
        "modelId": "google/gemini-2.5-flash:free"
      },
      {
        "providerId": "openai",
        "modelId": "gpt-4o-mini"
      }
    ]
  }
];

const DEFAULT_CONFIG = {
  globalProxy: '',
  globalProxyEnabled: false,
  rateLimitQueueEnabled: true,
  rateLimitQueueTimeoutMs: 180000,
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

// ─────────────────────────────────────────────────
// Chat Session Store (persisted to chat-sessions.json)
// ─────────────────────────────────────────────────

let chatSessions = [];
let chatMessages = [];

function loadChatData() {
  try {
    if (fs.existsSync(SESSIONS_PATH)) {
      const data = JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf8'));
      chatSessions = data.sessions || [];
      chatMessages = data.messages || [];
    }
  } catch (err) {
    console.error('Error loading chat sessions, starting fresh:', err);
    chatSessions = [];
    chatMessages = [];
  }
}

function saveChatData() {
  try {
    fs.writeFileSync(SESSIONS_PATH, JSON.stringify({ sessions: chatSessions, messages: chatMessages }, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving chat sessions:', err);
  }
}

// Initialize on module load
loadChatData();

export function getAllChatSessions() {
  return [...chatSessions].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function createChatSession() {
  const id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const session = { id, title: 'New Chat', createdAt: new Date().toISOString() };
  chatSessions.push(session);
  saveChatData();
  return session;
}

export function updateChatSessionTitle(sessionId, title) {
  const session = chatSessions.find(s => s.id === sessionId);
  if (session) {
    session.title = title.slice(0, 50);
    saveChatData();
    return session;
  }
  return null;
}

export function deleteChatSession(sessionId) {
  chatSessions = chatSessions.filter(s => s.id !== sessionId);
  chatMessages = chatMessages.filter(m => m.sessionId !== sessionId);
  saveChatData();
}

export function getMessagesBySession(sessionId) {
  return chatMessages.filter(m => m.sessionId === sessionId).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

export function addChatMessage(sessionId, role, content, steps = []) {
  const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const msg = { id, sessionId, role, content, steps, createdAt: new Date().toISOString() };
  chatMessages.push(msg);
  saveChatData();
  return msg;
}

export function truncateChatMessagesFromIndex(sessionId, fromIndex) {
  const sessionMsgs = chatMessages
    .filter(m => m.sessionId === sessionId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const idsToDelete = new Set(sessionMsgs.slice(fromIndex).map(m => m.id));
  chatMessages = chatMessages.filter(m => !idsToDelete.has(m.id));
  saveChatData();
}

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
      
      merged.virtualModels = (parsed.virtualModels || DEFAULT_VIRTUAL_MODELS).map(vm => {
        const defaultVm = DEFAULT_VIRTUAL_MODELS.find(d => d.id === vm.id);
        return {
          strategy: vm.strategy || defaultVm?.strategy || 'priority',
          config: {
            maxRetries: 1,
            timeoutMs: 30000,
            cooldownMs: 60000,
            fallbackOn5xx: true,
            fallbackOn429: true,
            fallbackOn403: true,
            ...(defaultVm?.config || {}),
            ...(vm.config || {})
          },
          ...vm
        };
      });
      
      DEFAULT_PROVIDERS.forEach(defaultProv => {
        const found = merged.providers.find(p => p.id === defaultProv.id);
        if (!found) {
          merged.providers.push({ ...defaultProv, apiKeys: [] });
        }
      });

      // Migrate stale pool entries once at load time. This prevents old
      // provider/model combinations from being reconsidered on every request.
      merged.virtualModels = merged.virtualModels.map(vm => ({
        ...vm,
        targets: (vm.targets || []).filter(target => {
          const provider = merged.providers.find(p => p.id === target.providerId);
          if (!provider) return false;
          return resolveProviderModelId(provider, target.modelId, target.upstreamModelId) !== null;
        })
      }));

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
  
  const logStr = `[${level}] ${message} ${details ? JSON.stringify(details) : ''}`;
  console.log(logStr);

  if (level === 'ERROR' || message.includes('ERROR calling')) {
    try {
      const logFilePath = path.join(__dirname, '..', 'gateway_errors.log');
      fs.appendFileSync(logFilePath, `[${logItem.timestamp}] ${logStr}\n`);
    } catch (e) {
      // Ignore write errors
    }
  }
}

export function getLogs() {
  return memoryLogs;
}

export function clearLogs() {
  memoryLogs = [];
}

// ---------------------------------------------------------------------------
// In-memory stats buffer
// ---------------------------------------------------------------------------
// Stats counters (totalRequests, latency, etc.) are mutated on EVERY chat
// request. Reading + writing the entire config.json on each request blocked
// the event loop and killed throughput. Instead we keep the live stats object
// in memory, mutate it directly, and flush to disk on a debounce.
//
// The flush merges our in-memory counter fields onto a FRESHLY-loaded config
// so we never clobber concurrent management-route edits to non-counter fields
// (providers, keys, stats.hiddenBefore, ...).

const STATS_FLUSH_INTERVAL_MS = 3000;
const STATS_HISTORY_PATH = path.join(__dirname, '..', 'stats-history.json');

let statsCache = null;        // live in-memory copy of config.stats
let statsDirty = false;
let statsFlushTimer = null;
let statsHistory = [];
let statsHistoryLoaded = false;
let statsHistoryDirty = false;
let statsHistoryTimer = null;

// Fields that are pure runtime counters owned by this buffer. Everything else
// on config.stats (e.g. hiddenBefore) is preserved from disk on flush.
const RUNTIME_COUNTER_FIELDS = [
  'totalRequests', 'successfulRequests', 'failedRequests',
  'tokensSaved', 'approximateCostSaved', 'latency'
];

function loadStatsIntoCache() {
  const config = loadConfig();
  statsCache = { ...(config.stats || {}) };
  if (!statsCache.latency) statsCache.latency = {};
  return statsCache;
}

export function getStats() {
  if (statsCache === null) {
    loadStatsIntoCache();
  }
  return statsCache;
}

export function scheduleStatsFlush() {
  statsDirty = true;
  if (statsFlushTimer) return;
  statsFlushTimer = setTimeout(flushStats, STATS_FLUSH_INTERVAL_MS);
  statsFlushTimer.unref?.();
}

function pickCounterFields(source) {
  const out = {};
  for (const f of RUNTIME_COUNTER_FIELDS) {
    if (source[f] !== undefined) out[f] = source[f];
  }
  return out;
}

export function flushStats() {
  if (statsFlushTimer) {
    clearTimeout(statsFlushTimer);
    statsFlushTimer = null;
  }
  flushStatsHistory();
  if (!statsDirty || statsCache === null) return;
  statsDirty = false;
  try {
    // Read a FRESH config from disk so we don't clobber concurrent edits to
    // non-counter fields (providers, keys, stats.hiddenBefore, ...).
    const diskConfig = loadConfig();
    diskConfig.stats = { ...(diskConfig.stats || {}), ...pickCounterFields(statsCache) };
    saveConfig(diskConfig);
  } catch (err) {
    console.error('Error flushing stats:', err);
    statsDirty = true; // retry on next cycle
  }
}

// --- Latency ---------------------------------------------------------------
// Latency EMA is kept in memory only; the latency-strategy pool reordering is
// now performed per-request in router.js via getLatency() (no disk I/O).

export function recordLatency(providerId, modelId, latencyMs) {
  const stats = getStats();
  if (!stats.latency) stats.latency = {};
  const key = `${providerId}:${modelId}`;
  const currentAvg = stats.latency[key];
  if (!currentAvg) {
    stats.latency[key] = latencyMs;
  } else {
    // Exponential moving average: 20% new, 80% old history
    stats.latency[key] = Math.round((currentAvg * 0.8) + (latencyMs * 0.2));
  }
  scheduleStatsFlush();
}

export function getLatency(providerId, modelId) {
  const stats = getStats();
  if (!stats || !stats.latency) return 1000;
  const key = `${providerId}:${modelId}`;
  return stats.latency[key] || 1000;
}

// --- Stats history (in-memory array, debounced disk flush) -----------------

export function loadStatsHistory() {
  if (!statsHistoryLoaded) {
    try {
      if (fs.existsSync(STATS_HISTORY_PATH)) {
        statsHistory = JSON.parse(fs.readFileSync(STATS_HISTORY_PATH, 'utf8'));
      } else {
        statsHistory = [];
      }
    } catch (err) {
      console.error('Error loading stats history:', err);
      statsHistory = [];
    }
    statsHistoryLoaded = true;
  }

  const stats = getStats();
  if (stats.hiddenBefore) {
    const hiddenTime = new Date(stats.hiddenBefore).getTime();
    return statsHistory.filter(entry => new Date(entry.timestamp).getTime() >= hiddenTime);
  }

  return statsHistory;
}

function scheduleStatsHistoryFlush() {
  statsHistoryDirty = true;
  if (statsHistoryTimer) return;
  statsHistoryTimer = setTimeout(flushStatsHistory, STATS_FLUSH_INTERVAL_MS);
  statsHistoryTimer.unref?.();
}

export function flushStatsHistory() {
  if (statsHistoryTimer) {
    clearTimeout(statsHistoryTimer);
    statsHistoryTimer = null;
  }
  if (!statsHistoryDirty) return;
  statsHistoryDirty = false;
  try {
    fs.writeFileSync(STATS_HISTORY_PATH, JSON.stringify(statsHistory, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving stats history:', err);
    statsHistoryDirty = true;
  }
}

// Kept for backward compatibility — now triggers a debounced flush.
export function saveStatsHistory() {
  scheduleStatsHistoryFlush();
}

export function addStatsHistoryEntry(entry) {
  if (!statsHistoryLoaded) {
    loadStatsHistory();
  }
  const fullEntry = {
    timestamp: new Date().toISOString(),
    ...entry
  };
  statsHistory.unshift(fullEntry);
  if (statsHistory.length > 3000) {
    statsHistory = statsHistory.slice(0, 3000);
  }
  scheduleStatsHistoryFlush();
}

export function clearStatsHistory() {
  statsHistory = [];
  statsHistoryLoaded = true;
  statsHistoryDirty = false;
  if (statsHistoryTimer) {
    clearTimeout(statsHistoryTimer);
    statsHistoryTimer = null;
  }
  try {
    if (fs.existsSync(STATS_HISTORY_PATH)) {
      fs.unlinkSync(STATS_HISTORY_PATH);
    }
  } catch (err) {
    console.error('Error deleting stats history file:', err);
  }
}
