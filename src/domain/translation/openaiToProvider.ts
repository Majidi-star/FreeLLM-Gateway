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
        const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        if (text && text.trim().length > 0) {
          anthropicMessages.push({
            role: msg.role,
            content: msg.content,
          });
        }
      }
    }

    if (anthropicMessages.length === 0) {
      anthropicMessages.push({
        role: 'user',
        content: 'Proceed.',
      });
    }

    const validSystemTexts = systemTexts
      .map(s => (typeof s === 'string' ? s.trim() : ''))
      .filter(s => s.length > 0);

    const systemPrompt = validSystemTexts.length > 0 ? validSystemTexts.join('\n\n') : undefined;

    const body: Record<string, unknown> = {
      model: targetModelName,
      messages: anthropicMessages,
      max_tokens: request.max_tokens || 4096,
      temperature: request.temperature,
      top_p: request.top_p,
      stream: request.stream || false,
    };

    if (systemPrompt !== undefined) {
      body.system = systemPrompt;
    }

    return {
      endpoint: '/v1/messages',
      headers: {
        'anthropic-version': '2023-06-01',
      },
      body,
    };
  }

  if (protocol === 'gemini') {
    const systemTexts: string[] = [];
    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

    for (const m of request.messages) {
      if (m.role === 'system') {
        systemTexts.push(typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
      } else if (m.role === 'user' || m.role === 'assistant') {
        const partText = (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).trim();
        if (partText.length === 0) {
          continue;
        }

        const role = m.role === 'assistant' ? 'model' : 'user';
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

    if (contents.length > 0 && contents[0].role === 'model') {
      contents.unshift({
        role: 'user',
        parts: [{ text: 'Conversation continuation:' }],
      });
    }

    const validSystemTexts = systemTexts
      .map(s => (typeof s === 'string' ? s.trim() : ''))
      .filter(s => s.length > 0);

    const systemInstruction = validSystemTexts.length > 0
      ? { parts: [{ text: validSystemTexts.join('\n\n') }] }
      : undefined;

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: request.temperature,
        topP: request.top_p,
        maxOutputTokens: request.max_tokens,
      },
    };

    if (systemInstruction !== undefined) {
      body.system_instruction = systemInstruction;
    }

    return {
      endpoint: `/v1beta/models/${targetModelName}:generateContent`,
      body,
    };
  }

  throw new Error(`Unsupported protocol '${protocol}' for translation`);
}
