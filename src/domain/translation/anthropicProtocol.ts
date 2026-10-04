import {
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  AnthropicContentBlock,
  AnthropicSystemPrompt,
} from './anthropicTypes.js';
import { OpenAIChatRequest, OpenAIChatResponse, OpenAIChatMessage, OpenAIChatContentPart } from './types.js';

function normalizeContent(
  content: string | any[] | null | undefined
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
 * consumed by GatewayService. System prompts, message roles, tools and max_tokens are mapped
 * explicitly.
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

  const mappedTools = body.tools?.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema || { type: 'object', properties: {} },
    },
  }));

  for (const msg of body.messages) {
    if (typeof msg.content === 'string') {
      messages.push({ role: msg.role, content: msg.content });
      continue;
    }

    if (Array.isArray(msg.content)) {
      const openAIContentParts: OpenAIChatContentPart[] = [];
      const toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];
      const toolResults: OpenAIChatMessage[] = [];

      for (const block of msg.content) {
        if (!block) continue;
        if (block.type === 'text') {
          openAIContentParts.push({ type: 'text', text: block.text || '' });
        } else if (block.type === 'image') {
          const source = block.source || {};
          const mediaType = source.media_type || 'image/jpeg';
          const data = source.data || '';
          const url = source.type === 'base64' ? `data:${mediaType};base64,${data}` : (source.url || '');
          openAIContentParts.push({
            type: 'image_url',
            image_url: { url },
          });
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input || {}),
            },
          });
        } else if (block.type === 'tool_result') {
          let resContent = '';
          if (typeof block.content === 'string') {
            resContent = block.content;
          } else if (Array.isArray(block.content)) {
            resContent = block.content
              .map((b: any) => (typeof b.text === 'string' ? b.text : JSON.stringify(b)))
              .join('\n');
          } else {
            resContent = JSON.stringify(block.content ?? '');
          }
          toolResults.push({
            role: 'tool',
            tool_call_id: block.tool_use_id,
            content: resContent,
          });
        }
      }

      if (toolResults.length > 0) {
        messages.push(...toolResults);
      }

      if (msg.role === 'user') {
        if (openAIContentParts.length > 0) {
          messages.push({
            role: 'user',
            content: openAIContentParts.length === 1 && openAIContentParts[0].type === 'text' ? openAIContentParts[0].text : openAIContentParts,
          });
        }
      } else if (msg.role === 'assistant') {
        if (openAIContentParts.length > 0 || toolCalls.length > 0) {
          messages.push({
            role: 'assistant',
            content: openAIContentParts.length === 1 && openAIContentParts[0].type === 'text' ? openAIContentParts[0].text : (openAIContentParts.length > 0 ? openAIContentParts : null),
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          });
        }
      }
    }
  }

  return {
    model: body.model,
    messages,
    max_tokens: body.max_tokens,
    temperature: body.temperature,
    top_p: body.top_p,
    stream: body.stream === true,
    ...(mappedTools && mappedTools.length > 0 ? { tools: mappedTools } : {}),
  };
}

function mapStopReason(
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null,
  hasToolCalls: boolean
): 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' {
  if (finishReason === 'tool_calls' || hasToolCalls) return 'tool_use';
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
  const content: AnthropicContentBlock[] = [];

  if (text.length > 0) {
    content.push({ type: 'text', text });
  }

  if (choice?.message?.tool_calls && choice.message.tool_calls.length > 0) {
    for (const tc of choice.message.tool_calls) {
      let inputObj: Record<string, unknown> = {};
      try {
        inputObj = typeof tc.function.arguments === 'string' ? (tc.function.arguments.trim() ? JSON.parse(tc.function.arguments) : {}) : (tc.function.arguments || {});
      } catch {
        inputObj = { raw: tc.function.arguments };
      }
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: inputObj,
      });
    }
  }

  const usageIn = response.usage?.prompt_tokens ?? 0;
  const usageOut = response.usage?.completion_tokens ?? 0;

  return {
    id: response.id,
    type: 'message',
    role: 'assistant',
    model: requestModel,
    content,
    stop_reason: mapStopReason(choice?.finish_reason ?? null, (choice?.message?.tool_calls?.length ?? 0) > 0),
    stop_sequence: null,
    usage: {
      input_tokens: usageIn,
      output_tokens: usageOut,
    },
  };
}
