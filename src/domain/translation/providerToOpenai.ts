import { OpenAIChatResponse } from './types.js';
import { generateId } from '../../shared/ids.js';

export function translateResponseToOpenAI(
  rawResponse: unknown,
  protocol: 'openai' | 'anthropic' | 'gemini' | 'custom',
  targetModelName: string
): OpenAIChatResponse {
  if (protocol === 'openai' || protocol === 'custom') {
    const oai = rawResponse as OpenAIChatResponse;
    return {
      ...oai,
      model: targetModelName,
    };
  }

  if (protocol === 'anthropic') {
    const ant = rawResponse as any;
    const content = Array.isArray(ant.content) ? ant.content : [];

    const textContent = content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n');

    const toolUseBlocks = content.filter((c: any) => c.type === 'tool_use');
    const toolCalls = toolUseBlocks.map((c: any) => ({
      id: c.id,
      type: 'function' as const,
      function: {
        name: c.name,
        arguments: typeof c.input === 'string' ? c.input : JSON.stringify(c.input ?? {}),
      },
    }));

    let finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' = 'stop';
    if (ant.stop_reason === 'end_turn' || ant.stop_reason === 'stop_sequence') {
      finishReason = 'stop';
    } else if (ant.stop_reason === 'max_tokens') {
      finishReason = 'length';
    } else if (ant.stop_reason === 'tool_use' || toolCalls.length > 0) {
      finishReason = 'tool_calls';
    }

    return {
      id: ant.id || generateId('chatcmpl'),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: targetModelName,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: textContent || null,
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          },
          finish_reason: finishReason,
        },
      ],
      usage: ant.usage
        ? {
            prompt_tokens: ant.usage.input_tokens || 0,
            completion_tokens: ant.usage.output_tokens || 0,
            total_tokens: (ant.usage.input_tokens || 0) + (ant.usage.output_tokens || 0),
          }
        : undefined,
    };
  }

  if (protocol === 'gemini') {
    const gem = rawResponse as any;
    const candidate = gem.candidates?.[0];
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];

    const textContent = parts
      .filter((p: any) => typeof p.text === 'string')
      .map((p: any) => p.text)
      .join('\n');

    const funcCallParts = parts.filter((p: any) => p.functionCall);
    const toolCalls = funcCallParts.map((p: any) => ({
      id: generateId('call'),
      type: 'function' as const,
      function: {
        name: p.functionCall.name,
        arguments: typeof p.functionCall.args === 'string' ? p.functionCall.args : JSON.stringify(p.functionCall.args ?? {}),
      },
    }));

    let finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' = 'stop';
    const gemFinish = candidate?.finishReason;
    if (gemFinish === 'STOP') {
      finishReason = 'stop';
    } else if (gemFinish === 'MAX_TOKENS') {
      finishReason = 'length';
    } else if (gemFinish === 'SAFETY' || gemFinish === 'RECITATION') {
      finishReason = 'content_filter';
    }

    if (toolCalls.length > 0) {
      finishReason = 'tool_calls';
    }

    return {
      id: generateId('chatcmpl'),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: targetModelName,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: textContent || null,
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          },
          finish_reason: finishReason,
        },
      ],
      usage: gem.usageMetadata
        ? {
            prompt_tokens: gem.usageMetadata.promptTokenCount || 0,
            completion_tokens: gem.usageMetadata.candidatesTokenCount || 0,
            total_tokens: gem.usageMetadata.totalTokenCount || 0,
          }
        : undefined,
    };
  }

  throw new Error(`Unsupported protocol '${protocol}' for response translation`);
}
