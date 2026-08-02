import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { addLog } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_PATH = path.join(__dirname, 'cache.json');

let cacheEntries = [];

export function initCache() {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      const data = fs.readFileSync(CACHE_PATH, 'utf8');
      cacheEntries = JSON.parse(data);
    } else {
      cacheEntries = [];
      fs.writeFileSync(CACHE_PATH, JSON.stringify([], null, 2), 'utf8');
    }
  } catch (err) {
    console.error('Error loading semantic cache file:', err);
    cacheEntries = [];
  }
}

function saveCache() {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cacheEntries, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving semantic cache file:', err);
  }
}

// Tokenize and clean text
function getTokens(str) {
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Replace punctuation with space
    .split(/\s+/)
    .filter(Boolean);
}

// Calculate token cosine similarity
export function calculateCosineSimilarity(str1, str2) {
  const tokens1 = getTokens(str1);
  const tokens2 = getTokens(str2);

  if (tokens1.length === 0 || tokens2.length === 0) return 0;

  const freq1 = {};
  const freq2 = {};
  const allTokens = new Set([...tokens1, ...tokens2]);

  tokens1.forEach(t => freq1[t] = (freq1[t] || 0) + 1);
  tokens2.forEach(t => freq2[t] = (freq2[t] || 0) + 1);

  let dotProduct = 0;
  let magnitude1 = 0;
  let magnitude2 = 0;

  for (const token of allTokens) {
    const f1 = freq1[token] || 0;
    const f2 = freq2[token] || 0;
    dotProduct += f1 * f2;
    magnitude1 += f1 * f1;
    magnitude2 += f2 * f2;
  }

  if (magnitude1 === 0 || magnitude2 === 0) return 0;
  return dotProduct / (Math.sqrt(magnitude1) * Math.sqrt(magnitude2));
}

// Extracts the prompt text (last user message content)
export function getPromptText(messages) {
  if (!Array.isArray(messages)) return '';
  // Find the last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return messages[i].content || '';
    }
  }
  return '';
}

// Retrieve cached completion if similarity matches threshold
export function getSemanticCachedResponse(messages, threshold = 0.92) {
  const incomingPrompt = getPromptText(messages);
  if (!incomingPrompt) return null;

  let bestMatch = null;
  let bestScore = 0;

  for (const entry of cacheEntries) {
    const score = calculateCosineSimilarity(incomingPrompt, entry.prompt);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  }

  if (bestScore >= threshold && bestMatch) {
    addLog('INFO', `Semantic Cache HIT (similarity score: ${(bestScore * 100).toFixed(1)}%)`, {
      incoming: incomingPrompt.substring(0, 100) + '...',
      cached: bestMatch.prompt.substring(0, 100) + '...'
    });
    return {
      completion: JSON.parse(bestMatch.completion),
      similarity: bestScore
    };
  }

  return null;
}

// Add completion to cache
export function addSemanticCache(messages, completionData) {
  const promptText = getPromptText(messages);
  if (!promptText || !completionData) return;

  // Check if already in cache with high similarity to avoid duplicate bloating
  const existing = getSemanticCachedResponse(messages, 0.98);
  if (existing) return;

  const newEntry = {
    id: `cache-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    prompt: promptText,
    completion: JSON.stringify(completionData),
    created_at: Date.now()
  };

  // Limit size to max 1000 items
  cacheEntries.unshift(newEntry);
  if (cacheEntries.length > 1000) {
    cacheEntries.pop();
  }

  saveCache();
}

export function clearCache() {
  cacheEntries = [];
  saveCache();
  addLog('INFO', 'Semantic cache cleared successfully.');
}

export function getCacheSize() {
  return cacheEntries.length;
}
