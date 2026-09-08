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
    const systemTexts: string[] = [];
    const anthropicMessages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        systemTexts.push(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
      } else if (msg.role === 'user' || msg.role === 'assistant') {
        anthropicMessages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    if (anthropicMessages.length === 0) {
      anthropicMessages.push({
        role: 'user',
        content: 'Proceed.',
      });
    }

    const systemPrompt = systemTexts.length > 0 ? systemTexts.join('\n\n') : undefined;

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
    const systemTexts: string[] = [];
    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

    for (const m of request.messages) {
      if (m.role === 'system') {
        systemTexts.push(typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
      } else if (m.role === 'user' || m.role === 'assistant') {
        const role = m.role === 'assistant' ? 'model' : 'user';
        const partText = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        const lastTurn = contents[contents.length - 1];

        if (lastTurn && lastTurn.role === role) {
          lastTurn.parts.push({ text: partText });
        } else {
          contents.push({
            role,
            parts: [{ text: partText }],
          });
        }
      }
    }

    const systemInstruction = systemTexts.length > 0
      ? { parts: [{ text: systemTexts.join('\n\n') }] }
      : undefined;

    return {
      endpoint: `/v1beta/models/${targetModelName}:generateContent`,
      body: {
        contents,
        system_instruction: systemInstruction,
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
