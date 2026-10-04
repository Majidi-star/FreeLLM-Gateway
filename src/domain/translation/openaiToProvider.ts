import { OpenAIChatMessage, OpenAIChatRequest } from './types.js';
import { logger } from '../../infra/logger.js';

export interface TranslatedRequest {
  endpoint: string;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

function findToolNameById(messages: OpenAIChatMessage[], toolCallId?: string): string | undefined {
  if (!toolCallId) return undefined;
  for (const m of messages) {
    if (m.tool_calls) {
      for (const tc of m.tool_calls) {
        if (tc.id === toolCallId) {
          return tc.function.name;
        }
      }
    }
  }
  return undefined;
}

function formatOpenAIContentToAnthropicBlocks(content: unknown): any[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  if (Array.isArray(content)) {
    const blocks: any[] = [];
    for (const item of content) {
      if (!item) continue;
      if (typeof item === 'string') {
        blocks.push({ type: 'text', text: item });
      } else if (item.type === 'text' && typeof item.text === 'string') {
        blocks.push({ type: 'text', text: item.text });
      } else if (item.type === 'image_url' || item.image_url) {
        const urlStr = item.image_url?.url || item.url;
        if (urlStr) {
          if (urlStr.startsWith('data:')) {
            const matches = urlStr.match(/^data:([^;]+);base64,(.+)$/);
            if (matches) {
              blocks.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: matches[1],
                  data: matches[2],
                },
              });
              continue;
            }
          }
          blocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: urlStr,
            },
          });
        }
      } else if (item.type === 'image' && item.source) {
        blocks.push({ type: 'image', source: item.source });
      }
    }
    return blocks.length > 0 ? blocks : [{ type: 'text', text: '' }];
  }
  return [{ type: 'text', text: JSON.stringify(content ?? '') }];
}

function formatOpenAIContentToGeminiParts(content: unknown): any[] {
  if (typeof content === 'string') {
    return content.trim().length > 0 ? [{ text: content }] : [];
  }
  if (Array.isArray(content)) {
    const parts: any[] = [];
    for (const item of content) {
      if (!item) continue;
      if (typeof item === 'string') {
        if (item.trim().length > 0) parts.push({ text: item });
      } else if (item.type === 'text' && typeof item.text === 'string') {
        if (item.text.trim().length > 0) parts.push({ text: item.text });
      } else if (item.type === 'image_url' || item.image_url) {
        const urlStr = item.image_url?.url || item.url;
        if (urlStr) {
          let mimeType = 'image/jpeg';
          let data = urlStr;
          if (urlStr.startsWith('data:')) {
            const matches = urlStr.match(/^data:([^;]+);base64,(.+)$/);
            if (matches) {
              mimeType = matches[1];
              data = matches[2];
            }
          }
          parts.push({
            inlineData: {
              mimeType,
              data,
            },
          });
        }
      } else if (item.type === 'image' && item.source) {
        parts.push({
          inlineData: {
            mimeType: item.source.media_type || 'image/jpeg',
            data: item.source.data || '',
          },
        });
      }
    }
    return parts;
  }
  return [];
}

export function translateRequestToProvider(
  request: OpenAIChatRequest,
  protocol: 'openai' | 'anthropic' | 'gemini' | 'custom',
  targetModelName: string
): TranslatedRequest {
  if (protocol === 'openai' || protocol === 'custom') {
    const body: Record<string, unknown> = {
      ...request,
      model: targetModelName,
    };
    if (request.stream) {
      body.stream_options = { include_usage: true };
    }
    return {
      endpoint: '/chat/completions',
      body,
    };
  }

  if (protocol === 'anthropic') {
    const systemTexts: string[] = [];
    const anthropicMessages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];

    const mappedTools = request.tools
      ?.filter(t => t.type === 'function')
      .map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters || { type: 'object', properties: {} },
      }));

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        systemTexts.push(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? ''));
      } else if (msg.role === 'user') {
        const blocks = formatOpenAIContentToAnthropicBlocks(msg.content);
        const lastMsg = anthropicMessages[anthropicMessages.length - 1];
        if (lastMsg && lastMsg.role === 'user') {
          if (Array.isArray(lastMsg.content)) {
            (lastMsg.content as any[]).push(...blocks);
          } else {
            const prevBlocks = formatOpenAIContentToAnthropicBlocks(lastMsg.content);
            lastMsg.content = [...prevBlocks, ...blocks];
          }
        } else {
          anthropicMessages.push({
            role: 'user',
            content: blocks.length === 1 && blocks[0].type === 'text' ? blocks[0].text : blocks,
          });
        }
      } else if (msg.role === 'assistant') {
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          const contentBlocks: any[] = [];
          if (msg.content) {
            const blocks = formatOpenAIContentToAnthropicBlocks(msg.content);
            contentBlocks.push(...blocks.filter(b => b.type !== 'text' || (b.text && b.text.trim().length > 0)));
          }
          for (const tc of msg.tool_calls) {
            contentBlocks.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input: typeof tc.function.arguments === 'string' ? (tc.function.arguments.trim() ? JSON.parse(tc.function.arguments) : {}) : (tc.function.arguments || {}),
            });
          }
          anthropicMessages.push({
            role: 'assistant',
            content: contentBlocks,
          });
        } else {
          const blocks = formatOpenAIContentToAnthropicBlocks(msg.content);
          anthropicMessages.push({
            role: 'assistant',
            content: blocks.length === 1 && blocks[0].type === 'text' ? blocks[0].text : blocks,
          });
        }
      } else if (msg.role === 'tool') {
        const toolResultBlock = {
          type: 'tool_result',
          tool_use_id: msg.tool_call_id,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? ''),
        };
        const lastMsg = anthropicMessages[anthropicMessages.length - 1];
        if (lastMsg && lastMsg.role === 'user') {
          if (Array.isArray(lastMsg.content)) {
            (lastMsg.content as any[]).push(toolResultBlock);
          } else {
            const prevBlocks = formatOpenAIContentToAnthropicBlocks(lastMsg.content);
            lastMsg.content = [...prevBlocks, toolResultBlock];
          }
        } else {
          anthropicMessages.push({
            role: 'user',
            content: [toolResultBlock],
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

    let systemPrompt = validSystemTexts.length > 0 ? validSystemTexts.join('\n\n') : undefined;

    if (request.response_format?.type === 'json_object') {
      const jsonInstruction = 'You must respond with valid JSON only, and nothing else.';
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${jsonInstruction}` : jsonInstruction;
    }

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

    if (mappedTools && mappedTools.length > 0) {
      body.tools = mappedTools;
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
    const contents: Array<{ role: 'user' | 'model'; parts: Array<Record<string, unknown>> }> = [];
    let hasSeenAssistantWithToolCalls = false;

    const functionDeclarations = request.tools
      ?.filter(t => t.type === 'function')
      .map(t => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      }));

    for (const m of request.messages) {
      if (m.role === 'system') {
        systemTexts.push(typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''));
      } else if (m.role === 'user') {
        const userParts = formatOpenAIContentToGeminiParts(m.content);
        if (userParts.length > 0) {
          const lastTurn = contents[contents.length - 1];
          if (lastTurn && lastTurn.role === 'user') {
            lastTurn.parts.push(...userParts);
          } else {
            contents.push({
              role: 'user',
              parts: userParts,
            });
          }
        }
      } else if (m.role === 'assistant') {
        const parts: Array<Record<string, unknown>> = [];
        if (m.content) {
          parts.push(...formatOpenAIContentToGeminiParts(m.content));
        }
        if (m.tool_calls && m.tool_calls.length > 0) {
          hasSeenAssistantWithToolCalls = true;
          for (const tc of m.tool_calls) {
            parts.push({
              functionCall: {
                name: tc.function.name,
                args: typeof tc.function.arguments === 'string' ? (tc.function.arguments.trim() ? JSON.parse(tc.function.arguments) : {}) : (tc.function.arguments || {}),
              },
            });
          }
        }
        if (parts.length > 0) {
          const lastTurn = contents[contents.length - 1];
          if (lastTurn && lastTurn.role === 'model') {
            lastTurn.parts.push(...parts);
          } else {
            contents.push({
              role: 'model',
              parts,
            });
          }
        }
      } else if (m.role === 'tool') {
        const toolName = m.name || findToolNameById(request.messages, m.tool_call_id) || 'tool';
        const contentStr = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
        if (!hasSeenAssistantWithToolCalls) {
          logger.warn({ toolCallId: m.tool_call_id, toolName }, 'Sanitizing orphan Gemini tool response with no preceding tool_calls');
          const orphanText = `[Tool Output: ${toolName}]: ${contentStr}`;
          const lastTurn = contents[contents.length - 1];
          if (lastTurn && lastTurn.role === 'user') {
            lastTurn.parts.push({ text: orphanText });
          } else {
            contents.push({
              role: 'user',
              parts: [{ text: orphanText }],
            });
          }
        } else {
          const funcRespPart = {
            functionResponse: {
              name: toolName,
              response: {
                result: contentStr,
              },
            },
          };
          const lastTurn = contents[contents.length - 1];
          if (lastTurn && lastTurn.role === 'user') {
            lastTurn.parts.push(funcRespPart);
          } else {
            contents.push({
              role: 'user',
              parts: [funcRespPart],
            });
          }
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

    const action = request.stream ? 'streamGenerateContent?alt=sse' : 'generateContent';

    const generationConfig: Record<string, unknown> = {
      temperature: request.temperature,
      topP: request.top_p,
      maxOutputTokens: request.max_tokens,
    };

    if (request.response_format?.type === 'json_object') {
      generationConfig.responseMimeType = 'application/json';
    }

    const body: Record<string, unknown> = {
      contents,
      generationConfig,
    };

    if (systemInstruction !== undefined) {
      body.system_instruction = systemInstruction;
    }

    if (functionDeclarations && functionDeclarations.length > 0) {
      body.tools = [{ function_declarations: functionDeclarations }];
    }

    return {
      endpoint: `/v1beta/models/${targetModelName}:${action}`,
      body,
    };
  }

  throw new Error(`Unsupported protocol '${protocol}' for translation`);
}
