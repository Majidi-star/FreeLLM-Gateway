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
    const textContent = (ant.content || [])
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n');

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
            content: textContent,
          },
          finish_reason: ant.stop_reason === 'end_turn' ? 'stop' : ant.stop_reason || 'stop',
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
    const textContent = candidate?.content?.parts?.[0]?.text || '';

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
            content: textContent,
          },
          finish_reason: candidate?.finishReason === 'STOP' ? 'stop' : 'stop',
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
