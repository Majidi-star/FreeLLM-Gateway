import { MultiPortServerService } from './multiPortServerService.js';
import type { ProtocolType, ProtocolEndpointConfig } from '../domain/server/types.js';

export interface EndpointDescriptor {
  protocol: 'openai' | 'anthropic' | 'mcp' | 'native';
  enabled: boolean;
  baseUrl: string;
  path: string;
  fullUrl: string;
  sdkBaseUrl: string;
  exampleCurl: string;
}

export function buildEndpointDescriptors(
  status: ReturnType<MultiPortServerService['getEndpointsStatus']>,
  opts: { host: string; poolId?: string | null }
): EndpointDescriptor[] {
  const endpoints = status.endpoints as Record<ProtocolType, ProtocolEndpointConfig>;
  const result: EndpointDescriptor[] = [];
  const protocolKeys = Object.keys(endpoints) as ProtocolType[];
  for (const protocol of protocolKeys) {
    const endpoint = endpoints[protocol];
    if (!endpoint.enabled) continue;
    const base = `http://${opts.host}:${endpoint.port}`;
    const path = endpoint.pathPrefix;
    const fullUrl = `${base}${path}`;
    const sdkBaseUrl = base;
    // Build exampleCurl
    let curl = `curl ${fullUrl}`;
    curl += `\n  -H \"Authorization: Bearer <YOUR_API_KEY>\"`;
    if (opts.poolId) {
      curl += `\n  -H \"x-goalroute-pool: ${opts.poolId}\"`;
    }
    if (protocol === 'openai' || protocol === 'anthropic') {
      curl += `\n  -H \"Content-Type: application/json\" \\`;
      curl += `\n  -d '{}'`;
    }
    result.push({
      protocol,
      enabled: true,
      baseUrl: base,
      path,
      fullUrl,
      sdkBaseUrl,
      exampleCurl: curl,
    });
  }
  return result;
}
