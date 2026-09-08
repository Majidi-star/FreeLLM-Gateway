import { generateId } from '../../shared/ids.js';

export interface UsageReport {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export async function* transformToOpenAISSEStream(
  upstreamStream: AsyncIterable<Uint8Array | string>,
  protocol: 'openai' | 'anthropic' | 'gemini' | 'custom',
  targetModelName: string,
  onUsage?: (usage: UsageReport) => void
): AsyncGenerator<string, void, unknown> {
  const streamId = generateId('chatcmpl');
  const created = Math.floor(Date.now() / 1000);

  let buffer = '';
  let accumulatedContent = '';
  let promptTokens = 0;
  let completionTokens = 0;
  let finalFinishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null = null;
  let emittedFinishReason = false;
  let currentAnthropicEvent = '';

  for await (const chunk of upstreamStream) {
    const textChunk = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk, { stream: true });
    buffer += textChunk;

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (protocol === 'anthropic') {
        if (trimmed.startsWith('event:')) {
          currentAnthropicEvent = trimmed.slice(6).trim();
          continue;
        }

        if (trimmed.startsWith('data:')) {
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr) continue;

          try {
            const data = JSON.parse(jsonStr);

            if (currentAnthropicEvent === 'message_start' || data.type === 'message_start') {
              if (data.message?.usage?.input_tokens) {
                promptTokens = data.message.usage.input_tokens;
              }
            } else if (currentAnthropicEvent === 'content_block_delta' || data.type === 'content_block_delta') {
              const delta = data.delta;
              if (delta) {
                if (delta.type === 'text_delta' || typeof delta.text === 'string') {
                  const text = delta.text || '';
                  if (text) {
                    accumulatedContent += text;
                    yield `data: ${JSON.stringify({
                      id: streamId,
                      object: 'chat.completion.chunk',
                      created,
                      model: targetModelName,
                      choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
                    })}\n\n`;
                  }
                } else if (delta.type === 'input_json_delta' || typeof delta.partial_json === 'string') {
                  const partialJson = delta.partial_json || '';
                  yield `data: ${JSON.stringify({
                    id: streamId,
                    object: 'chat.completion.chunk',
                    created,
                    model: targetModelName,
                    choices: [{
                      index: 0,
                      delta: {
                        tool_calls: [{
                          index: 0,
                          function: { arguments: partialJson },
                        }],
                      },
                      finish_reason: null,
                    }],
                  })}\n\n`;
                }
              }
            } else if (currentAnthropicEvent === 'content_block_start' || data.type === 'content_block_start') {
              const cb = data.content_block;
              if (cb && cb.type === 'tool_use') {
                yield `data: ${JSON.stringify({
                  id: streamId,
                  object: 'chat.completion.chunk',
                  created,
                  model: targetModelName,
                  choices: [{
                    index: 0,
                    delta: {
                      tool_calls: [{
                        index: 0,
                        id: cb.id,
                        type: 'function',
                        function: { name: cb.name, arguments: '' },
                      }],
                    },
                    finish_reason: null,
                  }],
                })}\n\n`;
              }
            } else if (currentAnthropicEvent === 'message_delta' || data.type === 'message_delta') {
              const stopReason = data.delta?.stop_reason;
              if (stopReason === 'end_turn' || stopReason === 'stop_sequence') {
                finalFinishReason = 'stop';
              } else if (stopReason === 'max_tokens') {
                finalFinishReason = 'length';
              } else if (stopReason === 'tool_use') {
                finalFinishReason = 'tool_calls';
              }
              if (data.usage?.output_tokens) {
                completionTokens = data.usage.output_tokens;
              }
            }
          } catch {
            // Ignore parse errors for non-JSON SSE data
          }
        }
      } else if (protocol === 'gemini') {
        if (trimmed.startsWith('data:')) {
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr) continue;

          try {
            const data = JSON.parse(jsonStr);

            if (data.usageMetadata) {
              promptTokens = data.usageMetadata.promptTokenCount || promptTokens;
              completionTokens = data.usageMetadata.candidatesTokenCount || completionTokens;
            }

            const candidate = data.candidates?.[0];
            if (candidate) {
              const gemFinish = candidate.finishReason;
              if (gemFinish === 'STOP') finalFinishReason = 'stop';
              else if (gemFinish === 'MAX_TOKENS') finalFinishReason = 'length';
              else if (gemFinish === 'SAFETY' || gemFinish === 'RECITATION') finalFinishReason = 'content_filter';

              const parts = candidate.content?.parts || [];
              for (const part of parts) {
                if (typeof part.text === 'string' && part.text.length > 0) {
                  accumulatedContent += part.text;
                  yield `data: ${JSON.stringify({
                    id: streamId,
                    object: 'chat.completion.chunk',
                    created,
                    model: targetModelName,
                    choices: [{ index: 0, delta: { content: part.text }, finish_reason: null }],
                  })}\n\n`;
                }

                if (part.functionCall) {
                  finalFinishReason = 'tool_calls';
                  const toolCallId = generateId('call');
                  yield `data: ${JSON.stringify({
                    id: streamId,
                    object: 'chat.completion.chunk',
                    created,
                    model: targetModelName,
                    choices: [{
                      index: 0,
                      delta: {
                        tool_calls: [{
                          index: 0,
                          id: toolCallId,
                          type: 'function',
                          function: {
                            name: part.functionCall.name,
                            arguments: typeof part.functionCall.args === 'string' ? part.functionCall.args : JSON.stringify(part.functionCall.args ?? {}),
                          },
                        }],
                      },
                      finish_reason: null,
                    }],
                  })}\n\n`;
                }
              }
            }
          } catch {
            // Ignore parse errors
          }
        }
      } else {
        if (trimmed.startsWith('data:')) {
          const jsonStr = trimmed.slice(5).trim();
          if (jsonStr === '[DONE]') continue;

          try {
            const data = JSON.parse(jsonStr);
            if (data.choices?.[0]?.finish_reason) {
              finalFinishReason = data.choices[0].finish_reason;
              emittedFinishReason = true;
            }
            if (data.usage) {
              promptTokens = data.usage.prompt_tokens || promptTokens;
              completionTokens = data.usage.completion_tokens || completionTokens;
            }
            data.model = targetModelName;
            yield `data: ${JSON.stringify(data)}\n\n`;
          } catch {
            yield `data: ${jsonStr}\n\n`;
          }
        }
      }
    }
  }

  if (buffer.trim().startsWith('data:')) {
    const jsonStr = buffer.trim().slice(5).trim();
    if (jsonStr && jsonStr !== '[DONE]') {
      try {
        const data = JSON.parse(jsonStr);
        if (protocol === 'gemini') {
          if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
            const text = data.candidates[0].content.parts[0].text;
            accumulatedContent += text;
            yield `data: ${JSON.stringify({
              id: streamId,
              object: 'chat.completion.chunk',
              created,
              model: targetModelName,
              choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
            })}\n\n`;
          }
        }
      } catch {
        // ignore
      }
    }
  }

  if (!emittedFinishReason) {
    yield `data: ${JSON.stringify({
      id: streamId,
      object: 'chat.completion.chunk',
      created,
      model: targetModelName,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: finalFinishReason || 'stop',
      }],
    })}\n\n`;
  }

  yield `data: [DONE]\n\n`;

  if (completionTokens === 0 && accumulatedContent.length > 0) {
    completionTokens = Math.ceil(accumulatedContent.length / 4);
  }

  if (onUsage) {
    onUsage({
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    });
  }
}
