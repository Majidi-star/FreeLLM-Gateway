export interface OpenAIChatContentPart {
  type: 'text' | 'image_url' | 'image';
  text?: string;
  image_url?: { url: string };
  source?: { type: string; media_type?: string; data?: string; url?: string };
}

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | OpenAIChatContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  response_format?: {
    type: 'json_object' | 'text';
  };
  tools?: Array<{ type: 'function'; function: { name: string; description?: string; parameters?: Record<string, unknown> } }>;
}

export interface OpenAIChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: OpenAIChatMessage;
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
