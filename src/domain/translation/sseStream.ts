import { generateId } from '../../shared/ids.js';
import { AppError } from '../../shared/errors.js';

export interface UsageReport {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

const FINISH_PRECEDENCE: Record<string, number> = {
  'tool_calls': 4,
  'content_filter': 3,
  'length': 2,
  'stop': 1,
};

function updateFinishReason(
  current: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null,
  incoming: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null
): 'stop' | 'length' | 'tool_calls' | 'content_filter' | null {
  if (!incoming) return current;
  if (!current) return incoming;
  const currentScore = FINISH_PRECEDENCE[current] || 0;
  const incomingScore = FINISH_PRECEDENCE[incoming] || 0;
  return incomingScore > currentScore ? incoming : current;
}

export async function* transformToOpenAISSEStream(
  upstreamStream: AsyncIterable<Uint8Array | string>,
  protocol: 'openai' | 'anthropic' | 'gemini' | 'custom',
  targetModelName: string,
  onUsage?: (usage: UsageReport) => void,
  onDone?: () => void,
  onError?: (err: any) => void
): AsyncGenerator<string, void, unknown> {
  const streamId = generateId('chatcmpl');
  const created = Math.floor(Date.now() / 1000);
  const decoder = new TextDecoder();

  let buffer = '';
  let accumulatedContent = '';
  let promptTokens = 0;
  let completionTokens = 0;
  let finalFinishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null = null;
  let emittedFinishReason = false;
  let currentAnthropicEvent = '';
  let geminiToolIndex = 0;
  let usageReported = false;

  const reportUsage = () => {
    if (usageReported) return;
    usageReported = true;
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
  };

  try {
    for await (const chunk of upstreamStream) {
      const textChunk = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      buffer += textChunk;
      if (buffer.length > 1024 * 1024) {
        throw new AppError('SSE stream line buffer overflow (1MB limit exceeded)', 'BUFFER_OVERFLOW', 502);
      }

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
                    accumulatedContent += partialJson;
                    const toolIndex = typeof data.index === 'number' ? data.index : 0;
                    yield `data: ${JSON.stringify({
                      id: streamId,
                      object: 'chat.completion.chunk',
                      created,
                      model: targetModelName,
                      choices: [{
                        index: 0,
                        delta: {
                          tool_calls: [{
                            index: toolIndex,
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
                  const toolIndex = typeof data.index === 'number' ? data.index : 0;
                  accumulatedContent += JSON.stringify(cb);
                  yield `data: ${JSON.stringify({
                    id: streamId,
                    object: 'chat.completion.chunk',
                    created,
                    model: targetModelName,
                    choices: [{
                      index: 0,
                      delta: {
                        tool_calls: [{
                          index: toolIndex,
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
                  finalFinishReason = updateFinishReason(finalFinishReason, 'stop');
                } else if (stopReason === 'max_tokens') {
                  finalFinishReason = updateFinishReason(finalFinishReason, 'length');
                } else if (stopReason === 'tool_use') {
                  finalFinishReason = updateFinishReason(finalFinishReason, 'tool_calls');
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
                if (gemFinish === 'STOP') finalFinishReason = updateFinishReason(finalFinishReason, 'stop');
                else if (gemFinish === 'MAX_TOKENS') finalFinishReason = updateFinishReason(finalFinishReason, 'length');
                else if (gemFinish === 'SAFETY' || gemFinish === 'RECITATION') finalFinishReason = updateFinishReason(finalFinishReason, 'content_filter');

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
                    finalFinishReason = updateFinishReason(finalFinishReason, 'tool_calls');
                    const toolCallId = generateId('call');
                    const toolIndex = geminiToolIndex++;
                    const argsStr = typeof part.functionCall.args === 'string' ? part.functionCall.args : JSON.stringify(part.functionCall.args ?? {});
                    accumulatedContent += (part.functionCall.name || '') + argsStr;
                    yield `data: ${JSON.stringify({
                      id: streamId,
                      object: 'chat.completion.chunk',
                      created,
                      model: targetModelName,
                      choices: [{
                        index: 0,
                        delta: {
                          tool_calls: [{
                            index: toolIndex,
                            id: toolCallId,
                            type: 'function',
                            function: {
                              name: part.functionCall.name,
                              arguments: argsStr,
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
                finalFinishReason = updateFinishReason(finalFinishReason, data.choices[0].finish_reason);
                emittedFinishReason = true;
              }
              if (data.choices?.[0]?.delta) {
                const delta = data.choices[0].delta;
                if (typeof delta.content === 'string') {
                  accumulatedContent += delta.content;
                }
                if (delta.tool_calls) {
                  accumulatedContent += JSON.stringify(delta.tool_calls);
                }
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
    reportUsage();
    if (onDone) onDone();
  } catch (err: any) {
    // The stream failed: onError performs the failure accounting (e.g. quota
    // refund). Suppress the finally-block report so one failed stream is not
    // also reported to onUsage as a successful (partial) usage event.
    usageReported = true;
    if (onError) onError(err);
    throw err;
  } finally {
    reportUsage();
  }
}

export async function* transformOpenAIToAnthropicSSEStream(
  openaiStream: AsyncIterable<string>,
  requestModel: string
): AsyncGenerator<string, void, unknown> {
  const messageId = generateId('msg');
  const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  yield sse('message_start', {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      model: requestModel,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });

  let textBlockStarted = false;
  let textIndex = 0;
  let outputTokens = 0;
  let finalStopReason = 'end_turn';
  let currentToolIndex = -1;

  for await (const chunk of openaiStream) {
    const lines = chunk.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const dataStr = trimmed.slice(5).trim();
      if (dataStr === '[DONE]') continue;

      try {
        const parsed = JSON.parse(dataStr);
        const choice = parsed.choices?.[0];
        if (!choice) continue;

        if (choice.delta?.content) {
          if (!textBlockStarted) {
            textBlockStarted = true;
            yield sse('content_block_start', {
              type: 'content_block_start',
              index: textIndex,
              content_block: { type: 'text', text: '' },
            });
          }
          const text = choice.delta.content;
          outputTokens += Math.ceil(text.length / 4);
          yield sse('content_block_delta', {
            type: 'content_block_delta',
            index: textIndex,
            delta: { type: 'text_delta', text },
          });
        }

        if (choice.delta?.tool_calls) {
          if (textBlockStarted) {
            yield sse('content_block_stop', { type: 'content_block_stop', index: textIndex });
            textBlockStarted = false;
          }
          for (const tc of choice.delta.tool_calls) {
            if (tc.function?.name) {
              currentToolIndex++;
              yield sse('content_block_start', {
                type: 'content_block_start',
                index: currentToolIndex,
                content_block: {
                  type: 'tool_use',
                  id: tc.id || generateId('call'),
                  name: tc.function.name,
                  input: {},
                },
              });
            }
            if (tc.function?.arguments) {
              const partialJson = tc.function.arguments;
              outputTokens += Math.ceil(partialJson.length / 4);
              yield sse('content_block_delta', {
                type: 'content_block_delta',
                index: currentToolIndex,
                delta: { type: 'input_json_delta', partial_json: partialJson },
              });
            }
          }
        }

        if (choice.finish_reason) {
          if (choice.finish_reason === 'tool_calls') {
            finalStopReason = 'tool_use';
          } else if (choice.finish_reason === 'length') {
            finalStopReason = 'max_tokens';
          } else {
            finalStopReason = 'end_turn';
          }
        }
      } catch {
        // ignore parse error
      }
    }
  }

  if (textBlockStarted) {
    yield sse('content_block_stop', { type: 'content_block_stop', index: textIndex });
  } else if (currentToolIndex >= 0) {
    yield sse('content_block_stop', { type: 'content_block_stop', index: currentToolIndex });
  }

  yield sse('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: finalStopReason, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  });

  yield sse('message_stop', { type: 'message_stop' });
}
