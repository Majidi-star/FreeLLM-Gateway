import { OpenAIChatRequest } from './types.js';

export interface TranslatedRequest {
  endpoint: string;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

export function translateRequestToProvider(
  request: OpenAIChatRequest,
  protocol: 'openai' | 'anthropic' | 'gemini' | 'custom',
  targetModelName: string
): TranslatedRequest {
  if (protocol === 'openai' || protocol === 'custom') {
    return {
      endpoint: '/chat/completions',
      body: {
        ...request,
        model: targetModelName,
      },
    };
  }

  if (protocol === 'anthropic') {
    let systemPrompt: string | undefined;
    const anthropicMessages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        systemPrompt = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      } else if (msg.role === 'user' || msg.role === 'assistant') {
        anthropicMessages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    return {
      endpoint: '/v1/messages',
      headers: {
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: targetModelName,
        system: systemPrompt,
        messages: anthropicMessages,
        max_tokens: request.max_tokens || 4096,
        temperature: request.temperature,
        top_p: request.top_p,
        stream: request.stream || false,
      },
    };
  }

  if (protocol === 'gemini') {
    const contents = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
      }));

    const systemInstruction = request.messages.find((m) => m.role === 'system');

    return {
      endpoint: `/v1beta/models/${targetModelName}:generateContent`,
      body: {
        contents,
        systemInstruction: systemInstruction
          ? { parts: [{ text: typeof systemInstruction.content === 'string' ? systemInstruction.content : JSON.stringify(systemInstruction.content) }] }
          : undefined,
        generationConfig: {
          temperature: request.temperature,
          topP: request.top_p,
          maxOutputTokens: request.max_tokens,
        },
      },
    };
  }

  throw new Error(`Unsupported protocol '${protocol}' for translation`);
}
