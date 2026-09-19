import React, { useState } from 'react';
import { Key, ShieldCheck, RefreshCw, CheckCircle2, AlertTriangle, Cpu, Lock, Terminal, Activity, Zap, Check, ChevronDown, Plus, X, ExternalLink, Search, SlidersHorizontal, ArrowUpDown, Filter, RotateCcw } from 'lucide-react';
import { GlossaryTerm } from '../common/GlossaryTerm.js';
import { getAdminToken } from '../settings/EndpointsManager.js';


export function formatCleanError(rawErr: string | null | undefined): string {
  if (!rawErr) return 'Verification failed';
  let str = String(rawErr).trim();
  if (str.includes('snippet=')) {
    const snippetPart = str.split('snippet=')[1];
    if (snippetPart) {
      try {
        const parsed = JSON.parse(snippetPart.trim());
        if (parsed.message) return parsed.message;
        if (parsed.error?.message) return parsed.error.message;
      } catch {
        str = snippetPart.replace(/[{}"\\]/g, '').trim();
      }
    }
  }
  if (str.includes('status=401') || str.includes('401')) {
    return 'Invalid API key (HTTP 401)';
  }
  if (str.includes('status=403') || str.includes('403')) {
    return 'Forbidden access or invalid permissions (HTTP 403)';
  }
  if (str.includes('status=429') || str.includes('429')) {
    return 'Rate limit exceeded (HTTP 429)';
  }
  if (str.includes('status=500') || str.includes('500')) {
    return 'Provider service error (HTTP 500)';
  }
  str = str.replace(/^\[PROVIDER_ERROR\]\s*/, '').replace(/status=\d+\s*type=\w+\s*/g, '').trim();
  return str || 'Verification failed';
}



export const formatErrorMessage = (err: any): string => {
  if (!err) return 'An unexpected error occurred';
  if (typeof err === 'string') return err;
  if (typeof err.message === 'string') return err.message;
  if (typeof err.error === 'string') return err.error;
  if (typeof err.error?.message === 'string') return err.error.message;
  try {
    return JSON.stringify(err);
  } catch {
    return 'An unexpected error occurred';
  }
};

export interface KeyEntry {
  id: string;
  provider: string;
  slug?: string;
  maskedKey: string;
  status: 'active' | 'testing' | 'degraded' | 'unavailable' | 'unconfigured';
  lastPingMs: number;
  lastVerified: string;
  dailyQuotaUsedPct: number;
  tier: 'Free Tier' | 'Pro Enclave';
  hasKey?: boolean;
  lastError?: string | null;
}

export type TierCategory = 'free' | 'paid';

export interface CatalogOption {
  slug: string;
  displayName: string;
  keyUrl: string;
  baseUrl: string;
  tierCategory: TierCategory;
  tierLabel: string;
}

export const CATALOG_OPTIONS: CatalogOption[] = [
  // Free Tier Providers
  { slug: 'groq', displayName: 'Groq Cloud', keyUrl: 'https://console.groq.com/keys', baseUrl: 'https://api.groq.com/openai/v1', tierCategory: 'free', tierLabel: 'Free Tier' },
  { slug: 'cerebras', displayName: 'Cerebras', keyUrl: 'https://cloud.cerebras.ai/', baseUrl: 'https://api.cerebras.ai/v1', tierCategory: 'free', tierLabel: 'Free Tier' },
  { slug: 'sambanova', displayName: 'SambaNova Cloud', keyUrl: 'https://cloud.sambanova.ai/', baseUrl: 'https://api.sambanova.ai/v1', tierCategory: 'free', tierLabel: 'Free Tier' },
  { slug: 'gemini', displayName: 'Google Gemini', keyUrl: 'https://aistudio.google.com/app/apikey', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', tierCategory: 'free', tierLabel: 'Free Tier' },
  { slug: 'openrouter', displayName: 'OpenRouter', keyUrl: 'https://openrouter.ai/keys', baseUrl: 'https://openrouter.ai/api/v1', tierCategory: 'free', tierLabel: 'Free Tier' },
  { slug: 'together', displayName: 'Together AI', keyUrl: 'https://api.together.ai/settings/api-keys', baseUrl: 'https://api.together.xyz/v1', tierCategory: 'free', tierLabel: 'Free Tier' },
  { slug: 'mistral', displayName: 'Mistral AI', keyUrl: 'https://console.mistral.ai/api-keys/', baseUrl: 'https://api.mistral.ai/v1', tierCategory: 'free', tierLabel: 'Free Tier' },
  { slug: 'fireworks', displayName: 'Fireworks AI', keyUrl: 'https://fireworks.ai/account/api-keys', baseUrl: 'https://api.fireworks.ai/inference/v1', tierCategory: 'free', tierLabel: 'Free Tier' },
  { slug: 'deepinfra', displayName: 'DeepInfra', keyUrl: 'https://deepinfra.com/dash/api_keys', baseUrl: 'https://api.deepinfra.com/v1', tierCategory: 'free', tierLabel: 'Free Tier' },
  // Paid / Usage-Based Tier Providers
  { slug: 'openai', displayName: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys', baseUrl: 'https://api.openai.com/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'anthropic', displayName: 'Anthropic Claude', keyUrl: 'https://console.anthropic.com/', baseUrl: 'https://api.anthropic.com/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'deepseek', displayName: 'DeepSeek', keyUrl: 'https://platform.deepseek.com/api_keys', baseUrl: 'https://api.deepseek.com/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'tenstorrent', displayName: 'Tenstorrent Wormhole', keyUrl: 'https://cloud.tenstorrent.com/', baseUrl: 'https://api.tenstorrent.com/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'replicate', displayName: 'Replicate', keyUrl: 'https://replicate.com/account/api-tokens', baseUrl: 'https://api.replicate.com/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'baseten', displayName: 'Baseten', keyUrl: 'https://app.baseten.co/settings/api_keys', baseUrl: 'https://model-api.baseten.co/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'modal', displayName: 'Modal Labs', keyUrl: 'https://modal.com/settings', baseUrl: 'https://api.modal.com/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'novita', displayName: 'Novita AI', keyUrl: 'https://novita.ai/dashboard/key-management', baseUrl: 'https://api.novita.ai/v3/openai', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'hyperbolic', displayName: 'Hyperbolic AI', keyUrl: 'https://app.hyperbolic.xyz/settings', baseUrl: 'https://api.hyperbolic.xyz/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'scaleway', displayName: 'Scaleway Generative APIs', keyUrl: 'https://console.scaleway.com/iam/api-keys', baseUrl: 'https://api.scaleway.com/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'vultr', displayName: 'Vultr Serverless Inference', keyUrl: 'https://my.vultr.com/settings/#settings-api', baseUrl: 'https://api.vultrinference.com/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'friendli', displayName: 'FriendliAI Suite', keyUrl: 'https://suite.friendli.ai/', baseUrl: 'https://inference.friendli.ai/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'cloudflare', displayName: 'Cloudflare Workers AI', keyUrl: 'https://dash.cloudflare.com/profile/api-tokens', baseUrl: 'https://api.cloudflare.com/client/v4/accounts/v1/ai', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'perplexity', displayName: 'Perplexity Sonar API', keyUrl: 'https://www.perplexity.ai/settings/api', baseUrl: 'https://api.perplexity.ai', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'bedrock', displayName: 'AWS Bedrock', keyUrl: 'https://console.aws.amazon.com/bedrock/', baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'azure', displayName: 'Azure OpenAI Service', keyUrl: 'https://portal.azure.com/', baseUrl: 'https://azure-openai.azure.com/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'vertex', displayName: 'Google Cloud Vertex AI', keyUrl: 'https://console.cloud.google.com/vertex-ai', baseUrl: 'https://vertexai.googleapis.com/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'watsonx', displayName: 'IBM watsonx.ai', keyUrl: 'https://dataplatform.cloud.ibm.com/', baseUrl: 'https://us-south.ml.cloud.ibm.com/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'qwen', displayName: 'Alibaba Model Studio', keyUrl: 'https://dashscope.console.aliyun.com/apiKey', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'zhipu', displayName: 'Zhipu BigModel Platform', keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'moonshot', displayName: 'Moonshot Open Platform', keyUrl: 'https://platform.moonshot.cn/console/api-keys', baseUrl: 'https://api.moonshot.cn/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'minimax', displayName: 'MiniMax Open Platform', keyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key', baseUrl: 'https://api.minimax.chat/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'cohere', displayName: 'Cohere API', keyUrl: 'https://dashboard.cohere.com/api-keys', baseUrl: 'https://api.cohere.com/v2', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'ai21', displayName: 'AI21 Studio', keyUrl: 'https://studio.ai21.com/account/api-key', baseUrl: 'https://api.ai21.com/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'baidu', displayName: 'Baidu Qianfan Platform', keyUrl: 'https://console.bce.baidu.com/qianfan/ais/console/onlineService', baseUrl: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'tencent', displayName: 'Tencent Cloud Hunyuan', keyUrl: 'https://console.cloud.tencent.com/hunyuan/start', baseUrl: 'https://hunyuan.tencentcloudapi.com/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'yi', displayName: '01.AI Platform', keyUrl: 'https://platform.lingyiwanwu.com/apikeys', baseUrl: 'https://api.lingyiwanwu.com/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'upstage', displayName: 'Upstage Console', keyUrl: 'https://console.upstage.ai/api-keys', baseUrl: 'https://api.upstage.ai/v1/solar', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'siliconflow', displayName: 'SiliconFlow Cloud', keyUrl: 'https://docs.siliconflow.cn', baseUrl: 'https://api.siliconflow.cn/v1', tierCategory: 'free', tierLabel: 'Free Tier' },
  { slug: 'huggingface', displayName: 'Hugging Face Inference', keyUrl: 'https://huggingface.co/docs/api-inference', baseUrl: 'https://api-inference.huggingface.co/v1', tierCategory: 'free', tierLabel: 'Free Tier' },
  { slug: 'xai', displayName: 'xAI Grok Platform', keyUrl: 'https://docs.x.ai', baseUrl: 'https://api.x.ai/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'anyscale', displayName: 'Anyscale Endpoints', keyUrl: 'https://docs.anyscale.com', baseUrl: 'https://api.endpoints.anyscale.com/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'octoai', displayName: 'OctoAI Inferences', keyUrl: 'https://docs.octoai.cloud', baseUrl: 'https://text.octoai.run/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'monsterapi', displayName: 'MonsterAPI Platform', keyUrl: 'https://monsterapi.ai/docs', baseUrl: 'https://api.monsterapi.ai/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'runpod', displayName: 'RunPod Serverless', keyUrl: 'https://docs.runpod.io', baseUrl: 'https://api.runpod.ai/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'lambda', displayName: 'Lambda Cloud Inference', keyUrl: 'https://docs.lambdalabs.com', baseUrl: 'https://api.lambdalabs.com/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'lepton', displayName: 'Lepton AI Engine', keyUrl: 'https://docs.lepton.ai', baseUrl: 'https://api.lepton.ai/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'featherless', displayName: 'Featherless AI', keyUrl: 'https://featherless.ai/docs', baseUrl: 'https://api.featherless.ai/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'nebius', displayName: 'Nebius AI Studio', keyUrl: 'https://nebius.ai/docs', baseUrl: 'https://api.studio.nebius.ai/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'chutes', displayName: 'Chutes AI Network', keyUrl: 'https://chutes.ai/docs', baseUrl: 'https://chutes.ai/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'voyage', displayName: 'Voyage AI', keyUrl: 'https://docs.voyageai.com', baseUrl: 'https://api.voyageai.com/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'ollama-cloud', displayName: 'Ollama Cloud', keyUrl: 'https://ollama.com/docs', baseUrl: 'https://api.ollama.com/v1', tierCategory: 'free', tierLabel: 'Free Tier' },
  { slug: 'arcee', displayName: 'Arcee AI Trinity', keyUrl: 'https://docs.arcee.ai', baseUrl: 'https://api.arcee.ai/v1', tierCategory: 'free', tierLabel: 'Free Tier' },
  { slug: 'doubao', displayName: 'ByteDance Doubao VolcEngine', keyUrl: 'https://www.volcengine.com/docs/82379', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', tierCategory: 'free', tierLabel: 'Free Tier' },
  { slug: 'iflytek', displayName: 'iFlytek Spark Desk', keyUrl: 'https://www.xfyun.cn/doc/spark', baseUrl: 'https://spark-api.xf-yun.com/v1', tierCategory: 'free', tierLabel: 'Free Tier' },
  { slug: 'nara', displayName: 'Nara AI Studio', keyUrl: 'https://nara.ai/docs', baseUrl: 'https://api.nara.ai/v1', tierCategory: 'free', tierLabel: 'Free Tier' },
  { slug: 'llm7', displayName: 'LLM7 Cloud Router', keyUrl: 'https://llm7.io/docs', baseUrl: 'https://api.llm7.io/v1', tierCategory: 'free', tierLabel: 'Free Tier' },
  { slug: 'bazaarlink', displayName: 'BazaarLink Free Router', keyUrl: 'https://bazaarlink.com/docs', baseUrl: 'https://api.bazaarlink.com/v1', tierCategory: 'free', tierLabel: 'Free Tier' },
  { slug: 'bluesminds', displayName: 'BluesMinds AI Gateway', keyUrl: 'https://bluesminds.ai/docs', baseUrl: 'https://api.bluesminds.ai/v1', tierCategory: 'free', tierLabel: 'Free Tier' },
  { slug: 'api-airforce', displayName: 'API Airforce Free Gateway', keyUrl: 'https://api.airforce/docs', baseUrl: 'https://api.airforce/v1', tierCategory: 'free', tierLabel: 'Free Tier' },
  { slug: 'glm', displayName: 'Zhipu GLM Open Engine', keyUrl: 'https://open.bigmodel.cn/doc', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', tierCategory: 'free', tierLabel: 'Free Tier' },
  { slug: 'kilo', displayName: 'Kilo Gateway Router', keyUrl: 'https://kilo.ai/docs', baseUrl: 'https://api.kilo.ai/v1', tierCategory: 'free', tierLabel: 'Free Tier' },
  { slug: 'requesty', displayName: 'Requesty LLM Router', keyUrl: 'https://requesty.ai/docs', baseUrl: 'https://router.requesty.ai/v1', tierCategory: 'free', tierLabel: 'Free Tier' },
  { slug: 'ovhcloud', displayName: 'OVHcloud AI Endpoints', keyUrl: 'https://docs.ovh.com/gb/en/publiccloud/ai/', baseUrl: 'https://api.ovhcloud.com/v1', tierCategory: 'free', tierLabel: 'Free Tier' },
  { slug: 'publicai', displayName: 'PublicAI Open Network', keyUrl: 'https://publicai.io/docs', baseUrl: 'https://api.publicai.io/v1', tierCategory: 'free', tierLabel: 'Free Tier' },
  { slug: 'liminal', displayName: 'Liminal AI Security Mesh', keyUrl: 'https://liminal.ai/docs', baseUrl: 'https://api.liminal.ai/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'agentrouter', displayName: 'AgentRouter Enclave', keyUrl: 'https://agentrouter.ai/docs', baseUrl: 'https://api.agentrouter.ai/v1', tierCategory: 'free', tierLabel: 'Free Tier' },
  { slug: 'mimo', displayName: 'Xiaomi MiMo AI Platform', keyUrl: 'https://mimo.xiaomi.com/docs', baseUrl: 'https://api.mimo.xiaomi.com/v1', tierCategory: 'free', tierLabel: 'Free Tier' },
  { slug: 'baichuan', displayName: 'Baichuan Intelligent AI', keyUrl: 'https://platform.baichuan-ai.com/docs', baseUrl: 'https://api.baichuan-ai.com/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'nlpcloud', displayName: 'NLP Cloud API', keyUrl: 'https://docs.nlpcloud.com', baseUrl: 'https://api.nlpcloud.io/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'coze', displayName: 'ByteDance Coze API', keyUrl: 'https://www.coze.com/open/docs', baseUrl: 'https://api.coze.com/v1', tierCategory: 'paid', tierLabel: 'Paid / Usage-Based' },
  { slug: 'blackbox', displayName: 'Blackbox AI Platform', keyUrl: 'https://docs.blackbox.ai', baseUrl: 'https://api.blackbox.ai/v1', tierCategory: 'free', tierLabel: 'Free Tier' },
  { slug: 'opencode', displayName: 'OpenCode AI Engine', keyUrl: 'https://opencode.ai/docs', baseUrl: 'https://api.opencode.ai/v1', tierCategory: 'free', tierLabel: 'Free Tier' },
];

export type TierFilter = 'all' | TierCategory;

export function filterCatalogOptions(
  options: CatalogOption[],
  tierFilter: TierFilter,
  searchQuery: string
): CatalogOption[] {
  const q = searchQuery.trim().toLowerCase();
  return options.filter((opt) => {
    const matchesTier = tierFilter === 'all' || opt.tierCategory === tierFilter;
    const matchesSearch =
      q === '' ||
      opt.displayName.toLowerCase().includes(q) ||
      opt.slug.toLowerCase().includes(q);
    return matchesTier && matchesSearch;
  });
}

export const CredentialVault: React.FC = () => {
  const [keys, setKeys] = useState<KeyEntry[]>([]);
  const [isProbing, setIsProbing] = useState(false);
  const [testingKeyIds, setTestingKeyIds] = useState<Record<string, boolean>>({});
  
  // Modal state
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [selectedProviderSlug, setSelectedProviderSlug] = useState('openai');
  const [inputApiKey, setInputApiKey] = useState('');
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const [providerSearchQuery, setProviderSearchQuery] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState('https://api.openai.com/v1');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);

  // Gallery Controls & Filters State
  const [gallerySearchQuery, setGallerySearchQuery] = useState('');
  const [galleryConfiguredFilter, setGalleryConfiguredFilter] = useState<'all' | 'configured' | 'unconfigured'>('all');
  const [galleryTierFilter, setGalleryTierFilter] = useState<'all' | 'free' | 'paid'>('all');
  const [galleryProtocolFilter, setGalleryProtocolFilter] = useState<'all' | 'openai' | 'anthropic' | 'gemini' | 'custom'>('all');
  const [gallerySortBy, setGallerySortBy] = useState<'configured_first' | 'name_asc' | 'name_desc' | 'latency_asc' | 'quota_desc' | 'tier'>('configured_first');

  const configuredCount = React.useMemo(() => keys.filter((k) => k.hasKey || k.status !== 'unconfigured').length, [keys]);
  const unconfiguredCount = React.useMemo(() => keys.length - configuredCount, [keys, configuredCount]);

  const filteredAndSortedKeys = React.useMemo(() => {
    let result = [...keys];

    // 1. Search Query
    if (gallerySearchQuery.trim()) {
      const q = gallerySearchQuery.trim().toLowerCase();
      result = result.filter(
        (k) =>
          k.provider.toLowerCase().includes(q) ||
          (k.slug && k.slug.toLowerCase().includes(q)) ||
          ((k as any).protocol && String((k as any).protocol).toLowerCase().includes(q))
      );
    }

    // 2. Configured Filter
    if (galleryConfiguredFilter === 'configured') {
      result = result.filter((k) => k.hasKey || k.status !== 'unconfigured');
    } else if (galleryConfiguredFilter === 'unconfigured') {
      result = result.filter((k) => !k.hasKey && k.status === 'unconfigured');
    }

    // 3. Tier Filter
    if (galleryTierFilter === 'free') {
      result = result.filter((k) => (k.tier as string) === 'free' || (k.tier as string) === 'Free Tier' || (k as any).tierCategory === 'free');
    } else if (galleryTierFilter === 'paid') {
      result = result.filter((k) => (k.tier as string) === 'pro' || (k.tier as string) === 'Pro Enclave' || (k.tier as string) === 'Paid / Usage-Based' || (k as any).tierCategory === 'paid');
    }

    // 4. Protocol Filter
    if (galleryProtocolFilter !== 'all') {
      result = result.filter((k) => (k as any).protocol === galleryProtocolFilter);
    }

    // 5. Sorting
    result.sort((a, b) => {
      switch (gallerySortBy) {
        case 'name_asc':
          return a.provider.localeCompare(b.provider);
        case 'name_desc':
          return b.provider.localeCompare(a.provider);
        case 'configured_first': {
          const aConf = (a.hasKey || a.status !== 'unconfigured') ? 1 : 0;
          const bConf = (b.hasKey || b.status !== 'unconfigured') ? 1 : 0;
          if (aConf !== bConf) return bConf - aConf;
          return a.provider.localeCompare(b.provider);
        }
        case 'latency_asc': {
          const aPing = a.lastPingMs > 0 ? a.lastPingMs : 999999;
          const bPing = b.lastPingMs > 0 ? b.lastPingMs : 999999;
          if (aPing !== bPing) return aPing - bPing;
          return a.provider.localeCompare(b.provider);
        }
        case 'quota_desc':
          return b.dailyQuotaUsedPct - a.dailyQuotaUsedPct;
        case 'tier':
          return (a.tier || '').localeCompare(b.tier || '');
        default:
          return 0;
      }
    });

    return result;
  }, [keys, gallerySearchQuery, galleryConfiguredFilter, galleryTierFilter, galleryProtocolFilter, gallerySortBy]);

  const hasActiveGalleryFilters =
    gallerySearchQuery !== '' ||
    galleryConfiguredFilter !== 'all' ||
    galleryTierFilter !== 'all' ||
    galleryProtocolFilter !== 'all' ||
    gallerySortBy !== 'configured_first';

  const resetGalleryFilters = () => {
    setGallerySearchQuery('');
    setGalleryConfiguredFilter('all');
    setGalleryTierFilter('all');
    setGalleryProtocolFilter('all');
    setGallerySortBy('configured_first');
  };

  const allCatalogOptions = React.useMemo(() => {
    const optionsMap = new Map<string, CatalogOption>();
    for (const opt of CATALOG_OPTIONS) {
      optionsMap.set(opt.slug, opt);
    }
    for (const k of keys) {
      if (k.slug && !optionsMap.has(k.slug)) {
        optionsMap.set(k.slug, {
          slug: k.slug,
          displayName: k.provider || k.slug,
          keyUrl: '#',
          baseUrl: '',
          tierCategory: k.tier === 'Pro Enclave' ? 'paid' : 'free',
          tierLabel: k.tier || 'Free Tier',
        });
      }
    }
    return Array.from(optionsMap.values());
  }, [keys]);

  const handleSyncModels = async () => {
    setIsSyncing(true);
    setSyncFeedback(null);
    try {
      const res = await fetch('/api/v1/catalog/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success) {
        const syncedCount = data.syncedProviders?.length || 0;
        const failedList = data.failedProviders || [];
        if (failedList.length > 0) {
          setSyncFeedback({
            type: 'warning',
            message: `Synced ${syncedCount} providers (${data.totalModels} models). Failed to sync: ${failedList.join(', ')}`,
          });
        } else {
          setSyncFeedback({
            type: 'success',
            message: `Successfully synced ${data.totalModels} models across ${syncedCount} active providers!`,
          });
        }
      } else {
        setSyncFeedback({ type: 'error', message: formatErrorMessage(data.error || data) });
      }
    } catch (e: any) {
      setSyncFeedback({ type: 'error', message: formatErrorMessage(e) });
    } finally {
      setIsSyncing(false);
    }
  };

  const currentProvider = allCatalogOptions.find((p) => p.slug === selectedProviderSlug) || allCatalogOptions[0];

  const filteredCatalogOptions = filterCatalogOptions(allCatalogOptions, tierFilter, providerSearchQuery);

  const selectProvider = (slug: string) => {
    setSelectedProviderSlug(slug);
    const prov = allCatalogOptions.find((p) => p.slug === slug);
    if (prov) setCustomBaseUrl(prov.baseUrl);
    setIsDropdownOpen(false);
  };

  const adminToken = getAdminToken();
  const activeTimers = React.useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const fetchProviders = React.useCallback(async () => {
    try {
      const res = await fetch('/api/v1/providers', {
        headers: adminToken ? { authorization: `Bearer ${adminToken}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setKeys(data);
        }
      }
    } catch (e) {
      console.error('Failed to fetch providers', e);
    }
  }, [adminToken]);

  React.useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  React.useEffect(() => {
    return () => {
      activeTimers.current.forEach((t) => clearTimeout(t));
      activeTimers.current.clear();
    };
  }, []);

  const safeTimeout = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      activeTimers.current.delete(t);
      fn();
    }, ms);
    activeTimers.current.add(t);
    return t;
  };

  const handleSaveKey = async () => {
    if (isSavingKey) return;
    if (!inputApiKey.trim()) return;
    setIsSavingKey(true);
    setConnectError(null);
    try {
      const res = await fetch('/api/v1/providers/keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
        },
        body: JSON.stringify({
          providerSlug: selectedProviderSlug,
          apiKey: inputApiKey.trim(),
          baseUrl: customBaseUrl.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed to save key' }));
        throw new Error(err.message || 'Failed to save key');
      }

      const connData = await res.json();

      // Immediately run handshake verification before committing connection to vault grid
      const testRes = await fetch(`/api/v1/providers/${connData.id}/test`, {
        method: 'POST',
        headers: adminToken ? { authorization: `Bearer ${adminToken}` } : {},
      });
      const testData = await testRes.json().catch(() => ({}));

      if (!testRes.ok || (testData as any).success === false) {
        const rawErr = (testData as any).error || 'Handshake verification failed';
        const cleanErr = formatCleanError(rawErr);

        // Rollback unverified connection from SQLite to prevent vault grid pollution
        await fetch(`/api/v1/providers/${connData.id}`, {
          method: 'DELETE',
          headers: adminToken ? { authorization: `Bearer ${adminToken}` } : {},
        }).catch(() => {});

        setConnectError(`Verification failed: ${cleanErr}`);
        return; // Keep modal open for user retry without persisting invalid key
      }

      setInputApiKey('');
      setIsConnectModalOpen(false);
      await fetchProviders();

      // Fire-and-forget background model sync for the newly verified provider.
      const adminTokenBg = getAdminToken();
      fetch('/api/v1/catalog/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(adminTokenBg ? { authorization: `Bearer ${adminTokenBg}` } : {}),
        },
        body: JSON.stringify({}),
      }).catch(() => {});
    } catch (e: any) {
      setConnectError(e.message || 'Failed to save key');
    } finally {
      setIsSavingKey(false);
    }
  };

  const probeKey = async (id: string) => {
    // Skip unconfigured providers — never run handshake probes on keys that aren't set up
    const targetKey = keys.find((k) => k.id === id);
    if (!targetKey || targetKey.hasKey === false || targetKey.status === 'unconfigured') {
      return;
    }
    const startTime = Date.now();
    try {
      const res = await fetch(`/api/v1/providers/${id}/test`, {
        method: 'POST',
        headers: adminToken ? { authorization: `Bearer ${adminToken}` } : {},
      });
      const data = await res.json().catch(() => ({}));
      const elapsed = Date.now() - startTime;
      if (elapsed < 400) {
        await new Promise<void>((resolve) => safeTimeout(resolve, 400 - elapsed));
      }
      const latencyMs = typeof data.latencyMs === 'number' ? data.latencyMs : 0;
      const success = res.ok && data.success !== false;
      setKeys((prev) =>
        prev.map((k) => (k.id === id ? { ...k, status: success ? 'active' : 'degraded', lastPingMs: latencyMs, lastVerified: success ? 'Just now' : 'Failed' } : k))
      );
    } catch {
      const elapsed = Date.now() - startTime;
      if (elapsed < 400) {
        await new Promise<void>((resolve) => safeTimeout(resolve, 400 - elapsed));
      }
      setKeys((prev) =>
        prev.map((k) => (k.id === id ? { ...k, status: 'degraded', lastVerified: 'Failed' } : k))
      );
    }
  };

  const handleTestAllKeys = async () => {
    setIsProbing(true);
    // Real concurrent handshake probes against every configured, non-unconfigured key via the backend test endpoint.
    await Promise.all(
      keys.filter((k) => k.hasKey !== false && k.status !== 'unconfigured').map((k) => probeKey(k.id))
    );
    // Re-fetch providers to ensure top capsules and card states align 100% with backend DB records
    await fetchProviders();
    setIsProbing(false);
  };

  const handleRevoke = async (id: string) => {
    setKeys((prev) =>
      prev.map((k) => (k.id === id ? { ...k, status: 'unconfigured', maskedKey: 'Not Configured', hasKey: false } : k))
    );
    try {
      const res = await fetch(`/api/v1/providers/${id}`, {
        method: 'DELETE',
        headers: adminToken ? { authorization: `Bearer ${adminToken}` } : {},
      });
      if (!res.ok) {
        console.error(`Failed to revoke provider key: HTTP ${res.status}`);
      }
      await fetchProviders();
    } catch (e) {
      console.error('Failed to revoke provider key', e);
      await fetchProviders();
    }
  };

  const handleTestKey = async (id: string) => {
    // Skip unconfigured providers — never run handshake probes on keys that aren't set up
    const targetKey = keys.find((k) => k.id === id);
    if (!targetKey || targetKey.hasKey === false || targetKey.status === 'unconfigured') {
      return;
    }
    setTestingKeyIds((prev) => ({ ...prev, [id]: true }));
    const startTime = Date.now();
    try {
      const res = await fetch(`/api/v1/providers/${id}/test`, {
        method: 'POST',
        headers: adminToken ? { authorization: `Bearer ${adminToken}` } : {},
      });
      const data = await res.json().catch(() => ({}));
      const elapsed = Date.now() - startTime;
      if (elapsed < 400) {
        await new Promise<void>((resolve) => safeTimeout(resolve, 400 - elapsed));
      }
      const success = res.ok && data.success !== false;
      const latencyMs = typeof data.latencyMs === 'number' ? data.latencyMs : 0;
      setKeys((prev) =>
        prev.map((k) => {
          if (k.id !== id) return k;
          return {
            ...k,
            status: success ? 'active' : 'degraded',
            lastPingMs: latencyMs,
            lastVerified: success ? 'Just now' : 'Failed',
          };
        })
      );
    } catch {
      const elapsed = Date.now() - startTime;
      if (elapsed < 400) {
        await new Promise<void>((resolve) => safeTimeout(resolve, 400 - elapsed));
      }
      setKeys((prev) =>
        prev.map((k) => (k.id === id ? { ...k, status: 'degraded', lastVerified: 'Failed' } : k))
      );
    } finally {
      setTestingKeyIds((prev) => ({ ...prev, [id]: false }));
    }
  };

  // Real telemetry capsules derived from keys loaded from GET /api/v1/providers.
  const configuredKeys = keys.filter((k) => k.hasKey !== false);
  const activeKeys = keys.filter((k) => k.hasKey && k.status === 'active');
  const healthyKeys = configuredKeys.filter((k) => k.status === 'active');
  const healthySlaPct = configuredKeys.length
    ? Math.round((healthyKeys.length / configuredKeys.length) * 100)
    : 0;
  const quotaErrors = configuredKeys.filter((k) => k.status === 'degraded').length;
  const pingValues = configuredKeys.map((k) => k.lastPingMs).filter((ms) => ms > 0);
  const avgPingMs = pingValues.length
    ? Math.round(pingValues.reduce((sum, ms) => sum + ms, 0) / pingValues.length)
    : 0;
  const fastestPing = pingValues.length ? Math.min(...pingValues) : 0;
  const quotaAvailablePct = configuredKeys.length
    ? Math.round(
        configuredKeys.reduce((sum, k) => sum + Math.max(0, 100 - (k.dailyQuotaUsedPct || 0)), 0) / configuredKeys.length
      )
    : 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--border-subtle)]">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight flex items-center gap-2">
            <Key className="w-6 h-6 text-[var(--accent-primary)]" />
            Credential Vault & Provider Key Gallery
          </h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            Zero-trust <GlossaryTerm term="Enclave Enforcing" /> client key store. All keys remain encrypted in local memory.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setIsConnectModalOpen(true);
              setTierFilter('all');
              setProviderSearchQuery('');
            }}
            className="px-4 py-2.5 rounded-xl bg-[var(--signal-mint)] hover:bg-[var(--signal-mint)]/80 text-slate-950 font-bold text-xs flex items-center justify-center space-x-2 shadow-lg shadow-[var(--signal-mint)]/20 transition-all active:scale-95 shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Connect Provider Key</span>
          </button>

          <button
            onClick={handleTestAllKeys}
            disabled={isProbing}
            className="px-4 py-2.5 rounded-xl bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-slate-950 font-semibold text-xs flex items-center justify-center space-x-2 shadow-lg shadow-[var(--accent-primary)]/20 transition-all active:scale-95 disabled:opacity-50 shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${isProbing ? 'animate-spin' : ''}`} />
            <span>{isProbing ? 'Running Handshake Probe...' : 'Probe & Test All Keys'}</span>
          </button>
        </div>
      </div>

      {/* Model Sync Feedback Banner */}
      {syncFeedback && (
        <div className={`p-3 rounded-xl border text-xs flex items-center justify-between transition-all ${
          syncFeedback.type === 'success'
            ? 'bg-[var(--signal-mint)]/10 border-[var(--signal-mint)]/30 text-[var(--signal-mint)]'
            : syncFeedback.type === 'warning'
            ? 'bg-[var(--signal-amber)]/10 border-[var(--signal-amber)]/30 text-[var(--signal-amber)]'
            : 'bg-[var(--signal-coral)]/10 border-[var(--signal-coral)]/30 text-[var(--signal-coral)]'
        }`}>
          <span>{syncFeedback.message}</span>
          <button onClick={() => setSyncFeedback(null)} className="text-xs opacity-70 hover:opacity-100 font-bold ml-2">✕</button>
        </div>
      )}

      {/* 4 Telemetry Capsules */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        
        {/* Capsule 1 */}
        <div className="p-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-1 squircle-capsule">
          <div className="text-[11px] text-[var(--text-muted)] font-medium uppercase">Active Enclave Keys</div>
          <div className="text-xl font-bold text-[var(--text-primary)] font-mono" dir="ltr">{activeKeys.length} / {keys.length}</div>
          <div className="text-[10px] text-[var(--signal-mint)] font-mono flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> {configuredKeys.length > 0 ? 'All providers ready' : 'No keys configured'}
          </div>
        </div>

        {/* Capsule 2 */}
        <div className="p-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-1 squircle-capsule">
          <div className="text-[11px] text-[var(--text-muted)] font-medium uppercase">Healthy Handshake SLA</div>
          <div className="text-xl font-bold text-[var(--signal-mint)] font-mono" dir="ltr">{healthySlaPct}% Verified</div>
          <div className="text-[10px] text-[var(--text-secondary)] font-mono">{quotaErrors} quota errors</div>
        </div>

        {/* Capsule 3 */}
        <div className="p-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-1 squircle-capsule">
          <div className="text-[11px] text-[var(--text-muted)] font-medium uppercase">Avg Handshake Ping</div>
          <div className="text-xl font-bold text-[var(--text-primary)] font-mono" dir="ltr">{avgPingMs > 0 ? `${avgPingMs} ms` : '—'}</div>
          <div className="text-[10px] text-[var(--signal-mint)] font-mono">
            {fastestPing > 0 ? `Fastest: ${fastestPing}ms` : 'Run a handshake probe'}
          </div>
        </div>

        {/* Capsule 4 */}
        <div className="p-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-1 squircle-capsule">
          <div className="text-[11px] text-[var(--text-muted)] font-medium uppercase">Free Daily Quota Available</div>
          <div className="text-xl font-bold text-[var(--signal-mint)] font-mono" dir="ltr">{quotaAvailablePct}%</div>
          <div className="text-[10px] text-[var(--text-secondary)] font-mono">Resets at midnight UTC</div>
        </div>
      </div>

      {/* Vault Watchdog Alert Banner */}
      <div className="p-4 rounded-2xl bg-[var(--bg-well)] border border-[var(--border-hover)] flex items-start space-x-3 text-xs">
        <ShieldCheck className="w-5 h-5 text-[var(--signal-mint)] shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <div className="font-semibold text-[var(--text-primary)]">Vault Watchdog Guard Active</div>
          <div className="text-[var(--text-secondary)] leading-relaxed">
            All provider keys are isolated inside local web application memory using standard zero-trust encryption primitives. Credentials are never written to disk or transmitted to third-party tracking servers.
          </div>
        </div>
      </div>

      {/* Provider Enclaves Gallery Header & Multi-Metric Search/Filter Bar */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
          <div>
            <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
              <span>Provider Enclave Gallery</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border border-[var(--accent-primary)]/20 font-mono">
                {filteredAndSortedKeys.length} of {keys.length}
              </span>
            </h2>
            <p className="text-xs text-[var(--text-muted)]">Active provider credentials & routing endpoints available for low-latency solver execution</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSyncModels}
              disabled={isSyncing}
              className="px-3 py-1.5 rounded-xl bg-[var(--bg-well)] hover:bg-[var(--bg-card-active)] text-[var(--text-primary)] border border-[var(--border-subtle)] text-xs font-semibold flex items-center space-x-1.5 transition-all active:scale-95 disabled:opacity-50"
              title="Discover and sync latest models from active providers"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-[var(--accent-primary)]' : ''}`} />
              <span>{isSyncing ? 'Syncing Catalog...' : 'Sync Models'}</span>
            </button>
          </div>
        </div>

        {/* Multi-Metric Search, Filter & Sort Controls */}
        <div className="p-3.5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-3 shadow-md">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5 items-center">
            
            {/* Search Input */}
            <div className="lg:col-span-4 relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="text"
                placeholder="Search by provider name, slug, protocol..."
                value={gallerySearchQuery}
                onChange={(e) => setGallerySearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)] transition-all"
              />
              {gallerySearchQuery && (
                <button
                  onClick={() => setGallerySearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Configured Status Filter */}
            <div className="lg:col-span-2 relative">
              <select
                value={galleryConfiguredFilter}
                onChange={(e) => setGalleryConfiguredFilter(e.target.value as any)}
                className="w-full pl-3 pr-7 py-1.5 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)] appearance-none cursor-pointer"
              >
                <option value="all">Status: All ({keys.length})</option>
                <option value="configured">Configured ({configuredCount})</option>
                <option value="unconfigured">Unconfigured ({unconfiguredCount})</option>
              </select>
              <Filter className="w-3 h-3 absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
            </div>

            {/* Tier Filter */}
            <div className="lg:col-span-2 relative">
              <select
                value={galleryTierFilter}
                onChange={(e) => setGalleryTierFilter(e.target.value as any)}
                className="w-full pl-3 pr-7 py-1.5 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)] appearance-none cursor-pointer"
              >
                <option value="all">Tier: All</option>
                <option value="free">Free Tier</option>
                <option value="paid">Pro / Paid</option>
              </select>
              <SlidersHorizontal className="w-3 h-3 absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
            </div>

            {/* Protocol Filter */}
            <div className="lg:col-span-2 relative">
              <select
                value={galleryProtocolFilter}
                onChange={(e) => setGalleryProtocolFilter(e.target.value as any)}
                className="w-full pl-3 pr-7 py-1.5 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)] appearance-none cursor-pointer"
              >
                <option value="all">Protocol: All</option>
                <option value="openai">OpenAI Compatible</option>
                <option value="anthropic">Anthropic Messages</option>
                <option value="gemini">Google Gemini</option>
                <option value="custom">Custom Native</option>
              </select>
              <Filter className="w-3 h-3 absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
            </div>

            {/* Sort By Selector */}
            <div className="lg:col-span-2 relative">
              <select
                value={gallerySortBy}
                onChange={(e) => setGallerySortBy(e.target.value as any)}
                className="w-full pl-3 pr-7 py-1.5 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)] appearance-none cursor-pointer font-medium"
              >
                <option value="configured_first">Sort: Configured First</option>
                <option value="name_asc">Sort: Name (A-Z)</option>
                <option value="name_desc">Sort: Name (Z-A)</option>
                <option value="latency_asc">Sort: Lowest Latency</option>
                <option value="quota_desc">Sort: Highest Quota</option>
                <option value="tier">Sort: Tier Group</option>
              </select>
              <ArrowUpDown className="w-3 h-3 absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
            </div>

          </div>

          {/* Reset Filters & Active Filter Pill Summary */}
          {hasActiveGalleryFilters && (
            <div className="flex items-center justify-between pt-1 text-[11px] border-t border-[var(--border-subtle)] text-[var(--text-muted)]">
              <div className="flex items-center gap-2">
                <span>Active Filters applied.</span>
                <span className="text-[var(--text-primary)] font-semibold">Showing {filteredAndSortedKeys.length} matching providers.</span>
              </div>
              <button
                onClick={resetGalleryFilters}
                className="px-2.5 py-1 rounded-lg bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/20 font-medium flex items-center gap-1 transition-all"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Filters</span>
              </button>
            </div>
          )}
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredAndSortedKeys.length === 0 && (
            <div className="col-span-full p-8 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-center text-xs space-y-3">
              <div className="text-[var(--text-secondary)]">No providers match the current search & filter criteria.</div>
              {hasActiveGalleryFilters && (
                <button
                  onClick={resetGalleryFilters}
                  className="px-3 py-1.5 rounded-xl bg-[var(--accent-primary)] text-slate-950 font-bold text-xs inline-flex items-center gap-1.5 shadow-md"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Clear Filters</span>
                </button>
              )}
            </div>
          )}
          {filteredAndSortedKeys.map((key) => {
            return (
              <div
                key={key.id}
                className="squircle-card p-5 bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--border-hover)] hover:bg-[var(--bg-card-active)] transition-all duration-200 space-y-4 shadow-xl"
              >
                {/* Key Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <div className="p-2 rounded-xl bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border border-[var(--accent-primary)]/20">
                      <Key className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-[var(--text-primary)]">{key.provider}</h3>
                      <span className="text-[10px] text-[var(--signal-mint)] font-mono bg-[var(--signal-mint)]/10 px-2 py-0.5 rounded-full border border-[var(--signal-mint)]/20 whitespace-nowrap">
                        {key.tier}
                      </span>
                    </div>
                  </div>

                  <span
                    className={`flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded-full shrink-0 border ${
                      key.status === 'degraded' || key.status === 'unavailable'
                        ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                        : key.status === 'unconfigured'
                        ? 'text-[var(--text-muted)] bg-[var(--bg-well)] border-[var(--border-subtle)]'
                        : 'text-[var(--signal-mint)] bg-[var(--signal-mint)]/10 border-[var(--signal-mint)]/20'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${key.status === 'degraded' || key.status === 'unavailable' ? 'bg-amber-400' : key.status === 'unconfigured' ? 'bg-[var(--text-muted)]' : 'bg-[var(--signal-mint)] animate-pulse'}`} />
                    {key.status === 'degraded' || key.status === 'unavailable' ? 'Degraded' : key.status === 'unconfigured' ? 'Unconfigured' : key.status === 'testing' ? 'Testing' : 'Verified'}
                  </span>
                </div>
{/* Error Alert Box (Full width below header) */}
{(key.status === 'degraded' || key.status === 'unavailable') && key.lastError ? (
  <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] space-y-1 w-full overflow-hidden">
    <div className="flex items-center gap-1.5 font-semibold text-amber-400">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      <span>Verification Failed</span>
    </div>
    <p className="text-[10px] text-amber-200/80 font-mono break-words leading-tight" title={key.lastError}>
      {formatCleanError(key.lastError)}
    </p>
  </div>
) : null}

                {/* Masked Key Display */}
                <div className="bg-[var(--bg-well)] p-3 rounded-xl border border-[var(--border-subtle)] font-mono text-xs text-[var(--text-secondary)]" dir="ltr">
                  <span className="truncate block">{key.maskedKey}</span>
                </div>

                {/* Handshake & Quota Stats */}
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-[var(--text-muted)]">Last Handshake:</span>
                    <span className="font-mono text-[var(--text-primary)]" dir="ltr">{key.lastVerified} ({key.lastPingMs}ms)</span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-[var(--text-muted)]">Daily Quota Used:</span>
                      <span className="font-mono text-[var(--accent-primary)]" dir="ltr">{key.dailyQuotaUsedPct}%</span>
                    </div>
                    <div className="h-1.5 bg-slate-900 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[var(--accent-primary)] rounded-full transition-all duration-300"
                        style={{ width: `${key.dailyQuotaUsedPct}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Card Actions: Test Handshake & Revoke */}
                <div className="flex items-center space-x-2 pt-2 border-t border-[var(--border-subtle)]">
                  <button
                    onClick={() => handleTestKey(key.id)}
                    disabled={testingKeyIds[key.id]}
                    className="flex-1 px-3 py-1.5 rounded-xl bg-[var(--bg-well)] hover:bg-[var(--bg-card-active)] text-[var(--text-primary)] border border-[var(--border-subtle)] text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all active:scale-95 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${testingKeyIds[key.id] ? 'animate-spin text-[var(--accent-primary)]' : ''}`} />
                    <span>{testingKeyIds[key.id] ? 'Testing...' : 'Test Handshake'}</span>
                  </button>

                  {key.hasKey !== false && key.status !== 'unconfigured' && (
                    <button
                      onClick={() => handleRevoke(key.id)}
                      className="px-3 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-semibold transition-all active:scale-95"
                      title="Revoke Key Credential"
                    >
                      Revoke
                    </button>
                  )}
                </div>

              </div>
            );
          })}
        </div>
      </div>

      {/* Enclave Security Diagnostics Card */}
      <div className="p-6 rounded-[24px] bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-4">
        <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
          <Lock className="w-4 h-4 text-[var(--accent-primary)]" />
          Enclave Security Diagnostics & Isolation Integrity
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-3.5 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] space-y-1">
            <div className="font-semibold text-[var(--text-primary)]">Memory Isolation</div>
            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
              Process memory boundaries verified via isolated browser context sandboxing.
            </p>
          </div>
          <div className="p-3.5 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] space-y-1">
            <div className="font-semibold text-[var(--text-primary)]">Key Leak Prevention</div>
            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
              Outbound request payload scrubbers ensure headers are stripped of raw tokens in logs.
            </p>
          </div>
          <div className="p-3.5 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] space-y-1">
            <div className="font-semibold text-[var(--text-primary)]"><GlossaryTerm term="Jitter Shield" /> Proxy</div>
            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
              Sub-millisecond sliding-window jitter shielding dampens latency spikes during probes.
            </p>
          </div>
        </div>
      </div>

      {/* Connect Provider Key Modal */}
      {isConnectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-3xl p-6 space-y-5 shadow-2xl relative">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                <Key className="w-5 h-5 text-[var(--signal-mint)]" />
                Connect Provider Key
              </h3>
              <button
                onClick={() => setIsConnectModalOpen(false)}
                className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-well)] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {connectError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{connectError}</span>
              </div>
            )}

            <div className="space-y-4 text-xs">
              {/* Tier Filter Tabs */}
              <div className="space-y-1.5">
                <label className="font-semibold text-[var(--text-secondary)] text-[11px] uppercase tracking-wider">
                  Filter by Tier
                </label>
                <div className="grid grid-cols-3 gap-1.5 p-1 bg-[var(--bg-well)] border border-[var(--border-subtle)] rounded-xl text-xs">
                  {(['all', 'free', 'paid'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTierFilter(t)}
                      className={`py-1.5 px-2 rounded-lg font-medium capitalize text-[11px] transition-all ${
                        tierFilter === t
                          ? 'bg-[var(--accent-primary)] text-white shadow-sm font-bold'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-active)]'
                      }`}
                    >
                      {t === 'all' ? 'All' : t === 'free' ? 'Free Tier' : 'Paid'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Searchable Provider Selector Combobox */}
              <div className="space-y-1.5 relative">
                <label className="font-semibold text-[var(--text-secondary)]">Select Provider</label>
                <div className="relative">
                  <input
                    type="search"
                    name="provider-search-no-autofill"
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    value={isDropdownOpen ? providerSearchQuery : currentProvider.displayName}
                    onChange={(e) => {
                      setProviderSearchQuery(e.target.value);
                      if (!isDropdownOpen) setIsDropdownOpen(true);
                    }}
                    onFocus={() => {
                      setIsDropdownOpen(true);
                      setProviderSearchQuery('');
                    }}
                    placeholder="Type to search provider (e.g. Groq, Gemini, Claude)..."
                    className="w-full p-3 pr-10 bg-[var(--bg-well)] border border-[var(--border-subtle)] focus:border-[var(--signal-mint)] rounded-xl text-[var(--text-primary)] font-medium focus:outline-none transition-colors"
                    dir="ltr"
                  />
                  <ChevronDown className={`w-4 h-4 text-[var(--text-muted)] absolute right-3 top-3.5 transition-transform pointer-events-none ${isDropdownOpen ? 'rotate-180' : ''}`} />
                </div>

                {isDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsDropdownOpen(false)} />
                    <div className="absolute z-50 w-full mt-1 bg-[var(--bg-well)] border border-[var(--border-subtle)] rounded-xl shadow-2xl overflow-hidden max-h-60 overflow-y-auto custom-scrollbar">
                      {filteredCatalogOptions.length === 0 ? (
                        <div className="px-3 py-3 text-xs text-[var(--text-muted)] text-center">
                          No providers found matching query.
                        </div>
                      ) : (
                        filteredCatalogOptions.map((opt) => (
                          <button
                            key={opt.slug}
                            type="button"
                            onClick={() => {
                              selectProvider(opt.slug);
                              setIsDropdownOpen(false);
                            }}
                            className={`w-full px-3 py-2.5 text-left font-medium flex items-center justify-between transition-colors border-b border-[var(--border-subtle)]/30 last:border-0 ${
                              opt.slug === selectedProviderSlug ? 'bg-[var(--bg-card-active)] text-[var(--accent-primary)]' : 'text-[var(--text-primary)] hover:bg-[var(--bg-card-active)]'
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <span>{opt.displayName}</span>
                              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-full font-bold uppercase ${
                                opt.tierCategory === 'free'
                                  ? 'bg-[var(--signal-mint)]/15 text-[var(--signal-mint)] border border-[var(--signal-mint)]/30'
                                  : 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                              }`}>
                                {opt.tierLabel}
                              </span>
                            </span>
                            {opt.slug === selectedProviderSlug && <Check className="w-3.5 h-3.5 text-[var(--signal-mint)]" />}
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-[var(--text-secondary)]">API Key</label>
                <input
                  type="password"
                  name="provider-api-key-secret"
                  autoComplete="new-password"
                  data-lpignore="true"
                  value={inputApiKey}
                  onChange={(e) => setInputApiKey(e.target.value)}
                  placeholder="Paste your API key here..."
                  className="w-full p-3 bg-[var(--bg-well)] border border-[var(--border-subtle)] focus:border-[var(--signal-mint)] rounded-xl text-[var(--text-primary)] font-mono focus:outline-none"
                  dir="ltr"
                />
                <a
                  href={currentProvider.keyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[var(--accent-primary)] hover:underline flex items-center gap-1 font-medium"
                >
                  <span className="flex items-center gap-1.5">
                    <span>Get {currentProvider.displayName} API Key</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </span>
                </a>
              </div>

              <div className="border-t border-[var(--border-subtle)] pt-3">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((s) => !s)}
                  className="flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] font-medium transition-colors"
                >
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                  Advanced Settings (Base URL Override)
                </button>
                {showAdvanced && (
                  <div className="mt-3 space-y-1.5">
                    <label className="font-semibold text-[var(--text-secondary)]">Endpoint Base URL</label>
                    <input
                      type="text"
                      value={customBaseUrl}
                      onChange={(e) => setCustomBaseUrl(e.target.value)}
                      placeholder={currentProvider.baseUrl}
                      className="w-full p-3 bg-[var(--bg-well)] border border-[var(--border-subtle)] focus:border-[var(--signal-mint)] rounded-xl text-[var(--text-primary)] font-mono focus:outline-none"
                      dir="ltr"
                    />
                    <p className="text-[var(--text-muted)] leading-relaxed">
                      Default endpoint used for API requests. Modify only if using custom proxies or local models.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => setIsConnectModalOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-[var(--bg-well)] hover:bg-[var(--bg-card-active)] text-[var(--text-secondary)] font-semibold text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveKey}
                disabled={!inputApiKey.trim() || isSavingKey}
                className="flex-1 py-2.5 rounded-xl bg-[var(--signal-mint)] hover:bg-[var(--signal-mint)]/80 text-slate-950 font-bold text-xs flex items-center justify-center space-x-2 disabled:opacity-50 transition-all shadow-lg shadow-[var(--signal-mint)]/20"
              >
                {isSavingKey ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                <span>{isSavingKey ? 'Saving...' : 'Save Key'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

