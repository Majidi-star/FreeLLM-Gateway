import json
import os
import re
import math

BENCHMARK_GROUND_TRUTH = {
    "meta-llama/llama-3.1-405b-instruct": {
        "contextWindow": 131072, "costIn": 0.002, "costOut": 0.005, "tps": 42.0, "ttft": 480, "p95": 1800,
        "reasoning": 51.1, "coding": 77.2, "command": 87.2, "math": 39.7, "vision": 0.0, "longContext": 93.2,
        "developer": "Meta"
    },
    "meta-llama/llama-3.3-70b-instruct": {
        "contextWindow": 131072, "costIn": 0.0006, "costOut": 0.0018, "tps": 78.0, "ttft": 280, "p95": 1100,
        "reasoning": 48.6, "coding": 74.5, "command": 88.4, "math": 36.4, "vision": 0.0, "longContext": 91.5,
        "developer": "Meta"
    },
    "meta-llama/llama-3.1-70b-instruct": {
        "contextWindow": 131072, "costIn": 0.00052, "costOut": 0.0015, "tps": 82.0, "ttft": 290, "p95": 1200,
        "reasoning": 44.3, "coding": 70.1, "command": 84.1, "math": 33.1, "vision": 0.0, "longContext": 88.6,
        "developer": "Meta"
    },
    "meta-llama/llama-3.1-8b-instruct": {
        "contextWindow": 131072, "costIn": 0.0001, "costOut": 0.0002, "tps": 165.0, "ttft": 140, "p95": 600,
        "reasoning": 25.5, "coding": 52.3, "command": 68.4, "math": 6.2, "vision": 0.0, "longContext": 82.0,
        "developer": "Meta"
    },
    "google/gemma-2-27b-it": {
        "contextWindow": 8192, "costIn": 0.00027, "costOut": 0.00055, "tps": 95.0, "ttft": 220, "p95": 900,
        "reasoning": 39.8, "coding": 66.8, "command": 79.4, "math": 26.2, "vision": 0.0, "longContext": 84.2,
        "developer": "Google"
    },
    "google/gemma-2-9b-it": {
        "contextWindow": 8192, "costIn": 0.0001, "costOut": 0.0002, "tps": 145.0, "ttft": 150, "p95": 700,
        "reasoning": 34.8, "coding": 57.4, "command": 71.2, "math": 13.4, "vision": 0.0, "longContext": 80.5,
        "developer": "Google"
    },
    "microsoft/phi-4": {
        "contextWindow": 16384, "costIn": 0.00025, "costOut": 0.0005, "tps": 110.0, "ttft": 190, "p95": 850,
        "reasoning": 42.1, "coding": 71.0, "command": 82.3, "math": 38.5, "vision": 0.0, "longContext": 86.0,
        "developer": "Microsoft"
    },
    "mistralai/mistral-large-2407": {
        "contextWindow": 131072, "costIn": 0.002, "costOut": 0.006, "tps": 68.0, "ttft": 320, "p95": 1400,
        "reasoning": 49.2, "coding": 76.8, "command": 86.5, "math": 38.9, "vision": 0.0, "longContext": 92.4,
        "developer": "Mistral AI"
    },
    "qwen/qwen-2.5-72b-instruct": {
        "contextWindow": 131072, "costIn": 0.00065, "costOut": 0.00195, "tps": 82.0, "ttft": 270, "p95": 1150,
        "reasoning": 52.4, "coding": 78.4, "command": 89.1, "math": 42.8, "vision": 0.0, "longContext": 93.0,
        "developer": "Qwen"
    },
    "qwen/qwen-2.5-coder-32b-instruct": {
        "contextWindow": 131072, "costIn": 0.00035, "costOut": 0.001, "tps": 105.0, "ttft": 210, "p95": 900,
        "reasoning": 46.8, "coding": 79.8, "command": 85.2, "math": 39.5, "vision": 0.0, "longContext": 90.0,
        "developer": "Qwen"
    },
    "deepseek-ai/deepseek-v3": {
        "contextWindow": 131072, "costIn": 0.00027, "costOut": 0.0011, "tps": 60.0, "ttft": 350, "p95": 1500,
        "reasoning": 53.8, "coding": 81.5, "command": 89.6, "math": 44.5, "vision": 0.0, "longContext": 94.5,
        "developer": "DeepSeek"
    },
    "deepseek-ai/deepseek-r1": {
        "contextWindow": 131072, "costIn": 0.00055, "costOut": 0.0022, "tps": 40.0, "ttft": 650, "p95": 2500,
        "reasoning": 56.4, "coding": 83.2, "command": 88.0, "math": 51.2, "vision": 0.0, "longContext": 92.0,
        "developer": "DeepSeek"
    },
    "openai/gpt-4o": {
        "contextWindow": 128000, "costIn": 0.0025, "costOut": 0.01, "tps": 95.0, "ttft": 380, "p95": 1300,
        "reasoning": 54.2, "coding": 82.0, "command": 88.8, "math": 45.2, "vision": 90.5, "longContext": 95.0,
        "developer": "OpenAI"
    },
    "openai/gpt-4o-mini": {
        "contextWindow": 128000, "costIn": 0.00015, "costOut": 0.0006, "tps": 140.0, "ttft": 180, "p95": 750,
        "reasoning": 40.2, "coding": 70.2, "command": 81.5, "math": 30.2, "vision": 82.0, "longContext": 89.0,
        "developer": "OpenAI"
    },
    "anthropic/claude-3-5-sonnet-20241022": {
        "contextWindow": 200000, "costIn": 0.003, "costOut": 0.015, "tps": 85.0, "ttft": 420, "p95": 1450,
        "reasoning": 55.6, "coding": 84.5, "command": 89.2, "math": 47.8, "vision": 91.8, "longContext": 96.0,
        "developer": "Anthropic"
    }
}

DEFAULT_FALLBACK = BENCHMARK_GROUND_TRUTH["meta-llama/llama-3.1-8b-instruct"]

def resolve_canonical(model_name: str) -> str:
    s = model_name.lower()
    for key in BENCHMARK_GROUND_TRUTH:
        if key in s or key.split("/")[1] in s:
            return key
    if "llama" in s:
        if "70b" in s or "3.3" in s:
            return "meta-llama/llama-3.3-70b-instruct"
        if "405b" in s:
            return "meta-llama/llama-3.1-405b-instruct"
        return "meta-llama/llama-3.1-8b-instruct"
    if "gemma" in s:
        return "google/gemma-2-9b-it"
    if "phi" in s:
        return "microsoft/phi-4"
    if "mistral" in s or "mixtral" in s:
        return "mistralai/mistral-large-2407"
    if "qwen" in s:
        if "coder" in s:
            return "qwen/qwen-2.5-coder-32b-instruct"
        return "qwen/qwen-2.5-72b-instruct"
    if "deepseek" in s:
        if "r1" in s:
            return "deepseek-ai/deepseek-r1"
        return "deepseek-ai/deepseek-v3"
    if "gpt-4o-mini" in s:
        return "openai/gpt-4o-mini"
    if "gpt-4" in s or "gpt-4o" in s:
        return "openai/gpt-4o"
    if "claude" in s:
        return "anthropic/claude-3-5-sonnet-20241022"
    return "meta-llama/llama-3.1-8b-instruct"

def clean_url(url: str, slug: str) -> str:
    if not url or not isinstance(url, str) or not url.startswith("http"):
        return f"https://api.{slug}.com/v1"
    return url

def main():
    data_path = os.path.join("PLAN", "llm_data.json")
    if not os.path.exists(data_path):
        print(f"File {data_path} not found.")
        return

    with open(data_path, "r", encoding="utf-8") as f:
        raw_data = json.load(f)

    raw_providers = raw_data.get("providers", [])
    raw_models = raw_data.get("models", [])

    EXPLICIT_BLACKLIST_SLUGS = {
        "suno", "cursor", "cursor-api", "antigravity", "agy", "kiro", "trae", "qoder",
        "codebuddy-cn", "zed-hosted", "devin-cli", "devin-cli-agentic", "devin-desktop",
        "github", "ghe-copilot", "gitlab-duo", "auggie", "zcode", "codex", "codex-app-server",
        "chatgpt-web", "chatgpt-web-codex", "claude-web", "gemini-web", "gemini-business",
        "grok-web", "grok-cli", "perplexity-web", "t3-web", "duckduckgo-web", "blackbox-web",
        "deepseek-web", "doubao-web", "kimi-web", "kimi-coding", "zai-web", "muse-spark-web",
        "notion-web", "adapta-web", "conol-web", "tencent-aistudio-web", "yuanbao-web",
        "tinycms-web", "veoaifree-web", "copilot-web", "copilot-m365-web", "huggingchat",
        "lmarena", "inner-ai", "xai-oauth", "uc", "chipotle", "cloudflare-playground",
        "promptql", "maxai", "hyperagent", "freebuff", "g4f-gemini", "g4f-groq",
        "g4f-nvidia", "g4f-ollama", "g4f-pollinations", "kilocode", "routeway",
        "gitlawb", "gitlawb-gmi", "adobe-firefly", "hailuo-web", "phind", "poe-web",
        "qwen-web", "v0-vercel-web", "venice-web", "felo-web", "theoldllm", "raycast", "zed"
    }

    UNETHICAL_URL_PATTERNS = [
        "daily-cloudcode-pa", "cloudcode-pa", "app.blackbox.ai", "agent.adapta.one",
        "amelia.chipotle.com", "playground.ai.cloudflare.com", "duckduckgo.com/duckchat",
        "theoldllm.vercel.app", "auggie://", "devin://", "backend.raycast.com", "cloud.zed.dev",
        "studio-api.suno.ai", "cursor.sh", "core-normal.trae.ai", "qoder.com", "copilot.tencent.com",
        "api.githubcopilot.com", "gitlab.com/api/v4/code_suggestions", "zcode://", "codex-app-server://",
        "cli-chat-proxy.grok.com", "chat.z.ai", "conol.ai", "yuanbao.tencent.com", "freegpt.win",
        "veoaifree.com", "m365copilot", "innerai.com", "pubyar.com", "maxai.me", "codebuff.com",
        "g4f.space", "routeway.ai", "gitlawb.com"
    ]

    providers_seed = []
    seen_slugs = set()
    blacklisted_slugs = set()

    for p in raw_providers:
        slug = p.get("slug") or "unknown"
        base_url = p.get("baseUrl") or ""

        is_unethical = (
            slug in EXPLICIT_BLACKLIST_SLUGS
            or any(pattern in str(base_url).lower() for pattern in UNETHICAL_URL_PATTERNS)
        )
        if is_unethical:
            blacklisted_slugs.add(slug)
            continue

        if slug in seen_slugs:
            continue
        seen_slugs.add(slug)

        display_name = p.get("displayName") or slug.replace("-", " ").capitalize()
        base_url = clean_url(p.get("baseUrl"), slug)
        auth_type = p.get("authType") or "api_key"
        if auth_type not in ["api_key", "oauth", "keyless"]:
            auth_type = "api_key"

        protocol = p.get("protocol") or "openai"
        if protocol not in ["openai", "anthropic", "gemini", "custom"]:
            protocol = "openai"

        docs_url = p.get("docsUrl")
        if not docs_url or not isinstance(docs_url, str) or not docs_url.startswith("http"):
            docs_url = f"https://{slug}.com/docs"

        caps = p.get("capabilities") or {}
        capabilities = {
            "vision": bool(caps.get("vision")),
            "tools": bool(caps.get("tools", True)),
            "streaming": bool(caps.get("streaming", True)),
            "jsonMode": bool(caps.get("jsonMode", True))
        }

        providers_seed.append({
            "slug": slug,
            "displayName": display_name,
            "baseUrl": base_url,
            "authType": auth_type,
            "protocol": protocol,
            "docsUrl": docs_url,
            "capabilities": capabilities,
            "isActive": bool(p.get("isActive", True))
        })

    models_seed = []
    seen_model_keys = set()

    for m in raw_models:
        prov_slug = m.get("providerSlug") or "unknown"
        if prov_slug in blacklisted_slugs or prov_slug in EXPLICIT_BLACKLIST_SLUGS:
            continue
        model_name = m.get("modelName") or "default-model"
        key = (prov_slug, model_name)
        if key in seen_model_keys:
            continue
        seen_model_keys.add(key)

        canonical_id = m.get("canonicalId") or resolve_canonical(model_name)
        gt = BENCHMARK_GROUND_TRUTH.get(canonical_id, DEFAULT_FALLBACK)

        display_name = m.get("displayName") or model_name
        ctx_win = m.get("contextWindow") or gt["contextWindow"]
        if not isinstance(ctx_win, int) or ctx_win <= 0:
            ctx_win = gt["contextWindow"]

        cost_in = m.get("costInputPer1k") if m.get("costInputPer1k") is not None else gt["costIn"]
        cost_out = m.get("costOutputPer1k") if m.get("costOutputPer1k") is not None else gt["costOut"]

        bm = m.get("benchmarks") or {}
        tps = bm.get("tps") or gt["tps"]
        ttft = bm.get("ttftMs") or gt["ttft"]
        p95 = bm.get("p95LatencyMs") or gt["p95"]

        reasoning = bm.get("reasoningScore") or gt["reasoning"]
        coding = bm.get("codingScore") or gt["coding"]
        command = bm.get("commandScore") or gt["command"]
        math_s = bm.get("mathScore") or gt["math"]
        vision = bm.get("visionScore") or gt["vision"]
        long_ctx = bm.get("longContextScore") or gt["longContext"]

        models_seed.append({
            "providerSlug": prov_slug,
            "canonicalId": canonical_id,
            "modelName": model_name,
            "displayName": display_name,
            "contextWindow": ctx_win,
            "supportsTools": bool(m.get("supportsTools", True)),
            "supportsVision": bool(m.get("supportsVision", False)),
            "costInputPer1k": float(cost_in),
            "costOutputPer1k": float(cost_out),
            "benchTps": float(tps),
            "benchTtftMs": float(ttft),
            "benchP95LatencyMs": float(p95),
            "benchReasoningScore": float(reasoning),
            "benchCodingScore": float(coding),
            "benchCommandScore": float(command),
            "benchMathScore": float(math_s),
            "benchVisionScore": float(vision),
            "benchLongContextScore": float(long_ctx),
            "taskFitness": {
                "json_schema": round(command / 100.0, 4),
                "function_calling": round(coding / 100.0, 4),
                "long_context_retrieval": round(long_ctx / 100.0, 4)
            },
            "isActive": bool(m.get("isActive", True))
        })

    os.makedirs(os.path.join("src", "catalog"), exist_ok=True)

    with open(os.path.join("src", "catalog", "providers.seed.json"), "w", encoding="utf-8") as f:
        json.dump(providers_seed, f, indent=2)

    with open(os.path.join("src", "catalog", "models.seed.json"), "w", encoding="utf-8") as f:
        json.dump(models_seed, f, indent=2)

    print(f"Generated {len(providers_seed)} providers and {len(models_seed)} models into src/catalog seed files.")

if __name__ == "__main__":
    main()
