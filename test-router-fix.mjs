import assert from 'node:assert';
import { providerSupportsModel, sanitizeProviderPayload } from './server/router.js';
import { resolveProviderModelId } from './server/db.js';

const reka = { id: 'reka' };

// 1. Regression fix: Reka + GLM/DeepSeek models must route again
assert.strictEqual(providerSupportsModel(reka, 'glm5.3'), true, 'reka glm5.3 must be supported');
assert.strictEqual(providerSupportsModel(reka, 'deepseek4-flash'), true, 'reka deepseek4-flash must be supported');
assert.strictEqual(providerSupportsModel(reka, 'reka-flash-3'), true, 'reka native models must be supported');

// 2. Config-driven blocklist still works when explicitly configured
const blocked = { id: 'x', blockedModels: ['^deepseek'] };
assert.strictEqual(providerSupportsModel(blocked, 'gpt-4o'), true);
assert.strictEqual(providerSupportsModel(blocked, 'deepseek4-flash'), false);

// 3. Malformed regex falls back to exact-match comparison
const badRegex = { id: 'x', blockedModels: ['(unclosed'] };
assert.strictEqual(providerSupportsModel(badRegex, '(unclosed'), false);
assert.strictEqual(providerSupportsModel(badRegex, 'glm5.3'), true);

// 4. Sanitizer: standard fields kept, junk + internal _fields stripped
const p1 = sanitizeProviderPayload(
  { model: 'glm5.3', messages: [], max_tokens: 10, temperature: 0.5, reasoning_effort: 'high', _failedBackends: 1 },
  reka, 'glm5.3'
);
assert.strictEqual(p1.max_tokens, 10);
assert.strictEqual(p1.reasoning_effort, undefined, 'reasoning_effort stripped for reka by default');
assert.strictEqual(p1._failedBackends, undefined);

// 5. Sanitizer: per-provider allowedExtraFields from config passes fields through
const p2 = sanitizeProviderPayload(
  { model: 'glm5.3', messages: [], reasoning_effort: 'high' },
  { id: 'reka', allowedExtraFields: ['reasoning_effort'] }, 'glm5.3'
);
assert.strictEqual(p2.reasoning_effort, 'high', 'config-driven extra field must pass through');

// 6. O-series passthrough preserved for OpenAI o-models
const p3 = sanitizeProviderPayload(
  { model: 'o3', messages: [], reasoning_effort: 'high', max_completion_tokens: 512 },
  { id: 'openai' }, 'o3'
);
assert.strictEqual(p3.reasoning_effort, 'high');
assert.strictEqual(p3.max_completion_tokens, 512);

// 7. Native model mapping: registered model ids resolve to themselves
const rekaProvider = { id: 'reka', models: [{ id: 'glm5.3' }, { id: 'reka-flash-3' }] };
assert.strictEqual(resolveProviderModelId(rekaProvider, 'glm5.3'), 'glm5.3');

// 8. Native model mapping: unregistered model with empty synced list resolves through
assert.strictEqual(resolveProviderModelId({ id: 'reka', models: [] }, 'deepseek4-flash'), 'deepseek4-flash');

// 9. Native model mapping: OpenRouter aliases translate to namespaced native ids
const openrouter = { id: 'openrouter', models: [{ id: 'deepseek/deepseek-chat' }] };
assert.strictEqual(resolveProviderModelId(openrouter, 'deepseek-chat'), 'deepseek/deepseek-chat');

// 10. Native model mapping: unknown model on fully synced provider resolves to null
assert.strictEqual(resolveProviderModelId(openrouter, 'totally-unknown'), null);

// 11. Native model mapping: explicit upstreamModelId wins over the pool's model id
assert.strictEqual(resolveProviderModelId(openrouter, 'deepseek-chat', 'deepseek/deepseek-chat'), 'deepseek/deepseek-chat');

// 12. No hardcoded blocklist regression: reka resolves glm/deepseek (bug class re-introduced in branch must stay fixed)
assert.strictEqual(resolveProviderModelId(rekaProvider, 'deepseek4-flash'), null,
  'unregistered model on synced provider must be null (but NOT because of a hardcoded blocklist)');
const rekaSynced = { id: 'reka', models: [{ id: 'glm5.3' }, { id: 'deepseek4-flash' }] };
assert.strictEqual(resolveProviderModelId(rekaSynced, 'deepseek4-flash'), 'deepseek4-flash',
  'registered deepseek on reka must resolve — hardcoded reka blocklist was removed');

console.log('ALL SMOKE TESTS PASSED');