import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { addLog } from './db.js';

/**
 * Builds Axios request agents for proxy support.
 * @param {string} proxyUrl - The HTTP/HTTPS/SOCKS5 proxy URL.
 * @returns {object|null} - An object containing httpAgent/httpsAgent, or null.
 */
export function getProxyAgent(proxyUrl) {
  if (!proxyUrl || typeof proxyUrl !== 'string' || proxyUrl.trim() === '') {
    return null;
  }

  try {
    const url = proxyUrl.trim();
    if (url.startsWith('socks5://') || url.startsWith('socks4://') || url.startsWith('socks://')) {
      const agent = new SocksProxyAgent(url);
      return {
        httpAgent: agent,
        httpsAgent: agent
      };
    } else if (url.startsWith('http://') || url.startsWith('https://')) {
      const agent = new HttpsProxyAgent(url);
      return {
        httpAgent: agent,
        httpsAgent: agent
      };
    } else {
      // Fallback to HTTP proxy if no protocol specified
      const agent = new HttpsProxyAgent(`http://${url}`);
      return {
        httpAgent: agent,
        httpsAgent: agent
      };
    }
  } catch (err) {
    addLog('ERROR', `Failed to construct proxy agent for URL: ${proxyUrl}`, err.message);
    return null;
  }
}

/**
 * Resolves the appropriate proxy agent for a given provider config.
 * @param {object} provider - The provider object from config.json.
 * @param {object} globalConfig - The global configuration.
 * @returns {object|null} - Combined http/https agent options.
 */
export function resolveProxyAgent(provider, globalConfig) {
  if (provider.proxyEnabled && provider.proxyUrl) {
    return getProxyAgent(provider.proxyUrl);
  }
  if (globalConfig.globalProxyEnabled && globalConfig.globalProxy) {
    return getProxyAgent(globalConfig.globalProxy);
  }
  return null;
}
