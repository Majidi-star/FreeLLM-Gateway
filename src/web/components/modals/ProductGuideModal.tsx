import React, { useState } from 'react';
import {
  X,
  BookOpen,
  Sparkles,
  Key,
  Layers,
  Terminal,
  ShieldCheck,
  Zap,
  Activity,
  Cpu,
  Copy,
  Check,
  ExternalLink,
  ChevronRight,
  RefreshCw,
  Sliders,
  Users,
  Database,
  Network,
  Wrench,
  Info,
} from 'lucide-react';

interface ProductGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: string;
}

export const ProductGuideModal: React.FC<ProductGuideModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'overview',
}) => {
  const [activeTab, setActiveTab] = useState<
    'overview' | 'providers' | 'goals' | 'pools' | 'accounts' | 'copilot'
  >(initialTab as any);

  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCopy = (code: string, id: string) => {
    try {
      void navigator.clipboard.writeText(code);
      setCopiedCode(id);
      setTimeout(() => setCopiedCode(null), 1800);
    } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-5xl max-h-[90vh] bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[28px] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header Bar */}
        <div className="px-6 py-5 border-b border-[var(--border-subtle)] flex items-center justify-between gap-4 bg-[var(--bg-well)]/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
              <BookOpen className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
                GoalRoute Gateway — Product Guide &amp; Architecture
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Comprehensive step-by-step documentation for configuring, routing, and scaling AI workloads.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-[var(--bg-card)] hover:bg-[var(--bg-card-active)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            title="Close Guide"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 px-6 pt-3 pb-0 border-b border-[var(--border-subtle)] bg-[var(--bg-card)] overflow-x-auto custom-scrollbar">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'overview'
                ? 'border-[var(--accent-primary)] text-[var(--accent-primary)] bg-[var(--accent-primary)]/5'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>1. Overview &amp; Quickstart</span>
          </button>

          <button
            onClick={() => setActiveTab('providers')}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'providers'
                ? 'border-amber-400 text-amber-400 bg-amber-400/5'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Key className="w-4 h-4" />
            <span>2. Providers &amp; Credentials</span>
          </button>

          <button
            onClick={() => setActiveTab('goals')}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'goals'
                ? 'border-purple-400 text-purple-400 bg-purple-400/5'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <TargetIcon className="w-4 h-4" />
            <span>3. Goal Studio &amp; Solver</span>
          </button>

          <button
            onClick={() => setActiveTab('pools')}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'pools'
                ? 'border-indigo-400 text-indigo-400 bg-indigo-400/5'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>4. Pools &amp; Self-Healing</span>
          </button>

          <button
            onClick={() => setActiveTab('accounts')}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'accounts'
                ? 'border-emerald-400 text-emerald-400 bg-emerald-400/5'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Terminal className="w-4 h-4" />
            <span>5. Endpoints &amp; API Keys</span>
          </button>

          <button
            onClick={() => setActiveTab('copilot')}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'copilot'
                ? 'border-cyan-400 text-cyan-400 bg-cyan-400/5'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Wrench className="w-4 h-4" />
            <span>6. AI Copilot &amp; MCP</span>
          </button>
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 text-sm leading-relaxed custom-scrollbar bg-[var(--bg-obsidian)]">
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="p-5 rounded-2xl bg-[var(--bg-well)] border border-[var(--border-subtle)] space-y-3">
                <div className="flex items-center gap-2 text-base font-bold text-[var(--text-primary)]">
                  <Sparkles className="w-5 h-5 text-indigo-400" />
                  <span>What is GoalRoute Gateway?</span>
                </div>
                <p className="text-[var(--text-secondary)]">
                  GoalRoute Gateway is a high-performance, self-healing multi-provider LLM proxy designed for high concurrency and production scale (1,000+ users). It unifies dozens of LLM APIs—including Groq, Google Gemini, Anthropic, OpenAI, DeepSeek, Together, OpenRouter, and local Ollama—into a single zero-downtime router.
                </p>
                <p className="text-[var(--text-secondary)]">
                  Instead of hardcoding a single provider API key into your applications, GoalRoute dynamically evaluates live latency, error rates, and remaining free quota to route every request to the optimal model instantly.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                  <div className="font-bold text-[var(--text-primary)] flex items-center gap-2 mb-2">
                    <Zap className="w-4 h-4 text-amber-400" />
                    <span>Sub-5ms Router Overhead</span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">
                    In-memory sliding window rate-limit checks and fast SQLite persistent logs ensure zero latency impact on your LLM streaming responses.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                  <div className="font-bold text-[var(--text-primary)] flex items-center gap-2 mb-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>Automatic Failover</span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">
                    If a primary LLM provider throws HTTP 429 rate limit or 5xx server errors, GoalRoute instantly switches to a backup provider mid-flight.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                  <div className="font-bold text-[var(--text-primary)] flex items-center gap-2 mb-2">
                    <Network className="w-4 h-4 text-purple-400" />
                    <span>Multi-Protocol Listeners</span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">
                    Native compatibility with OpenAI `/v1/chat/completions`, Anthropic `/v1/messages`, and Model Context Protocol (`/mcp/sse`).
                  </p>
                </div>
              </div>

              {/* Architecture Workflow Visual */}
              <div className="p-5 rounded-2xl bg-[var(--bg-well)] border border-[var(--border-subtle)] space-y-3">
                <h3 className="font-bold text-sm text-[var(--text-primary)]">End-to-End Execution Flow</h3>
                <div className="bg-[var(--bg-obsidian)] p-4 rounded-xl border border-[var(--border-subtle)] font-mono text-xs text-[var(--text-secondary)] overflow-x-auto">
                  Client Request ──► Multi-Protocol Port (8788/8789/8790) ──► Auth &amp; Rate Limiter ──► GoalSolver Candidate Sequence ──► Health &amp; Circuit Breaker Check ──► Upstream LLM Provider ──► SSE Stream Response
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: PROVIDERS & CREDENTIALS */}
          {activeTab === 'providers' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="p-5 rounded-2xl bg-[var(--bg-well)] border border-[var(--border-subtle)] space-y-3">
                <div className="flex items-center gap-2 text-base font-bold text-[var(--text-primary)]">
                  <Key className="w-5 h-5 text-amber-400" />
                  <span>Credential Vault &amp; Provider Enclave</span>
                </div>
                <p className="text-[var(--text-secondary)]">
                  The **Credential Vault** is where you store API keys for external LLM services. All credentials are encrypted using master-key AES-256-GCM before being stored in SQLite. Raw secrets are never printed in logs or transmitted over insecure channels.
                </p>
              </div>

              <div className="space-y-4">
                <h3 className="font-bold text-sm text-[var(--text-primary)]">How to Connect a Provider:</h3>
                <ol className="list-decimal list-inside space-y-2 text-[var(--text-secondary)]">
                  <li>Click **Credential Vault** in the left navigation sidebar.</li>
                  <li>Click **+ Add Provider Key**.</li>
                  <li>Select your provider (e.g. Groq, Google Gemini, Anthropic, OpenAI, DeepSeek, Together, OpenRouter, or Ollama).</li>
                  <li>Paste your API key and click **Save &amp; Verify Handshake**.</li>
                </ol>
              </div>

              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs leading-relaxed flex items-start gap-3">
                <Info className="w-5 h-5 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-bold block mb-1">Automatic Key Health Verification:</strong>
                  When you add a key, GoalRoute executes an instant live handshake test with the provider. If the key is invalid or revoked, it is rejected immediately to prevent vault pollution.
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: GOAL STUDIO */}
          {activeTab === 'goals' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="p-5 rounded-2xl bg-[var(--bg-well)] border border-[var(--border-subtle)] space-y-3">
                <div className="flex items-center gap-2 text-base font-bold text-[var(--text-primary)]">
                  <Sparkles className="w-5 h-5 text-purple-400" />
                  <span>Goal Studio &amp; The Self-Healing GoalSolver</span>
                </div>
                <p className="text-[var(--text-secondary)]">
                  A **Goal** is a declarative SLA specification for a specific AI workload. Instead of picking a single model, you define your target performance requirements, and GoalRoute's **GoalSolver** algorithm solves for the optimal model candidate order.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-2">
                  <h4 className="font-bold text-sm text-purple-400">1. Workload Task Types</h4>
                  <p className="text-xs text-[var(--text-muted)]">
                    Specify your task category (`coding_agent`, `research`, `chatbot`, `general`). Models with higher fitness scores for your task type are prioritized.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-2">
                  <h4 className="font-bold text-sm text-indigo-400">2. Latency &amp; Quality SLAs</h4>
                  <p className="text-xs text-[var(--text-muted)]">
                    Set maximum latency ceilings (e.g. `200ms`), target quality thresholds (`90-99%`), and minimum uptime availability requirements.
                  </p>
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-[var(--bg-well)] border border-[var(--border-subtle)] space-y-2">
                <h3 className="font-bold text-sm text-[var(--text-primary)]">1-Click Goal Deployment:</h3>
                <p className="text-xs text-[var(--text-secondary)]">
                  When you save a goal in Goal Studio, GoalRoute automatically solves the goal and materializes its corresponding **Routing Pool** in 1 click, making it instantly available to client applications.
                </p>
              </div>
            </div>
          )}

          {/* TAB 4: POOLS & FAILOVER */}
          {activeTab === 'pools' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="p-5 rounded-2xl bg-[var(--bg-well)] border border-[var(--border-subtle)] space-y-3">
                <div className="flex items-center gap-2 text-base font-bold text-[var(--text-primary)]">
                  <Layers className="w-5 h-5 text-indigo-400" />
                  <span>Pool Studio &amp; Self-Healing Failover</span>
                </div>
                <p className="text-[var(--text-secondary)]">
                  A **Routing Pool** is the live runtime execution route derived from a Goal (or custom setup). It defines an ordered sequence of candidate models (Primary, Backup, Overflow) that handle real-time user requests.
                </p>
              </div>

              <div className="space-y-3">
                <h3 className="font-bold text-sm text-[var(--text-primary)]">Circuit Breaker Lifecycle:</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
                    <strong className="block font-bold mb-1">CLOSED (Healthy)</strong>
                    Normal traffic flow. Requests pass directly to the primary provider.
                  </div>
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300">
                    <strong className="block font-bold mb-1">OPEN (Tripped)</strong>
                    Triggered after 5 consecutive failures or 429 quota exhaustion. Traffic instantly skips to the backup route.
                  </div>
                  <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-300">
                    <strong className="block font-bold mb-1">HALF_OPEN (Probe)</strong>
                    After 30s cooldown, the gateway sends a probe request to verify provider recovery before closing the circuit.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: ENDPOINTS & KEYS */}
          {activeTab === 'accounts' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="p-5 rounded-2xl bg-[var(--bg-well)] border border-[var(--border-subtle)] space-y-3">
                <div className="flex items-center gap-2 text-base font-bold text-[var(--text-primary)]">
                  <Terminal className="w-5 h-5 text-emerald-400" />
                  <span>Multi-Protocol Listener Endpoints &amp; Client Access</span>
                </div>
                <p className="text-[var(--text-secondary)]">
                  GoalRoute Gateway runs multiple dedicated listener ports so client applications, Cursor IDE, LangChain, and Claude Desktop can connect seamlessly without code changes.
                </p>
              </div>

              {/* Protocol Endpoints Card */}
              <div className="space-y-3">
                <h3 className="font-bold text-sm text-[var(--text-primary)] font-mono">Available Listener Ports:</h3>
                
                {/* OpenAI */}
                <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-emerald-400 font-mono">OpenAI Compatible Port (8788)</span>
                    <button
                      onClick={() => handleCopy('http://127.0.0.1:8788/v1', 'url_openai')}
                      className="text-xs font-mono px-2.5 py-1 rounded-md bg-[var(--bg-well)] hover:bg-[var(--accent-primary)]/15 border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      {copiedCode === 'url_openai' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>http://127.0.0.1:8788/v1</span>
                    </button>
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">
                    Use in Cursor, VS Code, OpenAI SDK, or LangChain by setting `OPENAI_BASE_URL=http://127.0.0.1:8788/v1`.
                  </p>
                </div>

                {/* Anthropic */}
                <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-purple-400 font-mono">Anthropic Messages Port (8789)</span>
                    <button
                      onClick={() => handleCopy('http://127.0.0.1:8789/v1/messages', 'url_anthropic')}
                      className="text-xs font-mono px-2.5 py-1 rounded-md bg-[var(--bg-well)] hover:bg-[var(--accent-primary)]/15 border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      {copiedCode === 'url_anthropic' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>http://127.0.0.1:8789/v1/messages</span>
                    </button>
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">
                    Use in Claude Desktop or Anthropic SDK by setting `ANTHROPIC_BASE_URL=http://127.0.0.1:8789`.
                  </p>
                </div>

                {/* MCP */}
                <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-cyan-400 font-mono">Model Context Protocol SSE (8790)</span>
                    <button
                      onClick={() => handleCopy('http://127.0.0.1:8790/mcp/sse', 'url_mcp')}
                      className="text-xs font-mono px-2.5 py-1 rounded-md bg-[var(--bg-well)] hover:bg-[var(--accent-primary)]/15 border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      {copiedCode === 'url_mcp' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>http://127.0.0.1:8790/mcp/sse</span>
                    </button>
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">
                    Connect external MCP clients to inspect quotas, solve goals, probe keys, and run system mutations automatically.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: AI COPILOT & MCP */}
          {activeTab === 'copilot' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="p-5 rounded-2xl bg-[var(--bg-well)] border border-[var(--border-subtle)] space-y-3">
                <div className="flex items-center gap-2 text-base font-bold text-[var(--text-primary)]">
                  <Wrench className="w-5 h-5 text-cyan-400" />
                  <span>AI Agentic Copilot &amp; Automated MCP Toolset</span>
                </div>
                <p className="text-[var(--text-secondary)]">
                  GoalRoute features a built-in **AI Agentic Copilot** on the right rail panel. The copilot is equipped with 16 automated MCP tools to monitor, inspect, probe, and manage your gateway infrastructure.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-1">
                  <strong className="font-bold text-[var(--text-primary)] block">`list_providers_and_connections`</strong>
                  <span className="text-[var(--text-muted)]">Lists all catalog providers, API keys, and health states.</span>
                </div>

                <div className="p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-1">
                  <strong className="font-bold text-[var(--text-primary)] block">`probe_provider_keys`</strong>
                  <span className="text-[var(--text-muted)]">Executes live latency and health probes across all configured keys.</span>
                </div>

                <div className="p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-1">
                  <strong className="font-bold text-[var(--text-primary)] block">`solve_routing_goal`</strong>
                  <span className="text-[var(--text-muted)]">Solves optimal model candidate chains for any task description.</span>
                </div>

                <div className="p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-1">
                  <strong className="font-bold text-[var(--text-primary)] block">`get_system_stats_and_logs`</strong>
                  <span className="text-[var(--text-muted)]">Queries traffic logs, latency metrics, and error rates.</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--border-subtle)] bg-[var(--bg-well)]/50 flex items-center justify-between">
          <span className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
            <Info className="w-4 h-4 text-indigo-400" />
            <span>GoalRoute Gateway 0.1.0 — Enterprise Multi-Provider Architecture</span>
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white font-semibold text-xs transition-all cursor-pointer shadow-md"
          >
            Got it, close guide
          </button>
        </div>
      </div>
    </div>
  );
};

function TargetIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}
