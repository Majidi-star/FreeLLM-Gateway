import {
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  AnthropicContentBlock,
  AnthropicSystemPrompt,
} from './anthropicTypes.js';
import { OpenAIChatRequest, OpenAIChatResponse, OpenAIChatMessage } from './types.js';

function normalizeContent(
  content: string | Array<{ type: string; text?: string }> | null | undefined
): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (typeof block.text === 'string' ? block.text : ''))
      .join('');
  }
  return '';
}

/**
 * Translates an Anthropic /v1/messages payload into the internal OpenAI chat format
 * consumed by GatewayService. System prompts, message roles and max_tokens are mapped
 * explicitly; unsupported fields are ignored (never silently reinterpreted).
 */
export function translateAnthropicToOpenAI(body: AnthropicMessagesRequest): OpenAIChatRequest {
  const messages: OpenAIChatMessage[] = [];

  const system = body.system;
  if (system !== undefined && system !== null) {
    const systemText =
      typeof system === 'string'
        ? system
        : system.map((block) => block.text).join('');
    if (systemText.length > 0) {
      messages.push({ role: 'system', content: systemText });
    }
  }

  for (const msg of body.messages) {
    const content = normalizeContent(msg.content);
    if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({ role: msg.role, content });
    }
  }

  return {
    model: body.model,
    messages,
    max_tokens: body.max_tokens,
    temperature: body.temperature,
    top_p: body.top_p,
    stream: body.stream === true,
  };
}

function mapStopReason(finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null): 'end_turn' | 'max_tokens' | 'stop_sequence' {
  if (finishReason === 'length') return 'max_tokens';
  return 'end_turn';
}

/**
 * Translates an internal OpenAI chat completion into an Anthropic Messages API response.
 */
export function translateOpenAIToAnthropic(
  response: OpenAIChatResponse,
  requestModel: string
): AnthropicMessagesResponse {
  const choice = response.choices[0];
  const text = normalizeContent(choice?.message?.content);

  const content: AnthropicContentBlock[] = text.length > 0 ? [{ type: 'text', text }] : [];

  const usageIn = response.usage?.prompt_tokens ?? 0;
  const usageOut = response.usage?.completion_tokens ?? 0;

  return {
    id: response.id,
    type: 'message',
    role: 'assistant',
    model: requestModel,
    content,
    stop_reason: mapStopReason(choice?.finish_reason ?? null),
    stop_sequence: null,
    usage: {
      input_tokens: usageIn,
      output_tokens: usageOut,
    },
  };
}
