export type ProtocolType = 'native' | 'openai' | 'anthropic' | 'mcp';

export interface ProtocolEndpointConfig {
  protocol: ProtocolType;
  enabled: boolean;
  port: number;
  pathPrefix: string;
  description: string;
  sampleCurl: string;
}

export interface SystemEndpointsStatus {
  host: string;
  remoteAccessEnabled: boolean;
  endpoints: Record<ProtocolType, ProtocolEndpointConfig>;
}

export interface UpdateEndpointsInput {
  remoteAccessEnabled?: boolean;
  ports?: Partial<Record<ProtocolType, number>>;
  enabledProtocols?: Partial<Record<ProtocolType, boolean>>;
}
