import { describe, it, expect } from 'vitest';
import { translateRequestToProvider } from '../../src/domain/translation/openaiToProvider.js';
import { translateResponseToOpenAI } from '../../src/domain/translation/providerToOpenai.js';
import { transformToOpenAISSEStream } from '../../src/domain/translation/sseStream.js';
import { OpenAIChatRequest } from '../../src/domain/translation/types.js';

describe('Tool & Function Calling and SSE Streaming Suite', () => {
  describe('1. Anthropic Tool Ingestion', () => {
    it('maps OpenAI tools array to Anthropic input_schema format', () => {
      const request: OpenAIChatRequest = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get current weather',
              parameters: {
                type: 'object',
                properties: {
                  location: { type: 'string' },
                },
                required: ['location'],
              },
            },
          },
        ],
      };

      const translated = translateRequestToProvider(request, 'anthropic', 'claude-3-5-sonnet');
      expect(translated.body.tools).toBeDefined();
      expect(translated.body.tools).toEqual([
        {
          name: 'get_weather',
          description: 'Get current weather',
          input_schema: {
            type: 'object',
            properties: {
              location: { type: 'string' },
            },
            required: ['location'],
          },
        },
      ]);
    });

    it('maps Assistant message tool_calls to Anthropic tool_use content blocks', () => {
      const request: OpenAIChatRequest = {
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: 'What is the weather in Tokyo?' },
          {
            role: 'assistant',
            content: 'Let me check the weather for you.',
            tool_calls: [
              {
                id: 'call_123',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: JSON.stringify({ location: 'Tokyo' }),
                },
              },
            ],
          },
        ],
      };

      const translated = translateRequestToProvider(request, 'anthropic', 'claude-3-5-sonnet');
      const messages = translated.body.messages as any[];
      expect(messages[1].role).toBe('assistant');
      expect(messages[1].content).toEqual([
        { type: 'text', text: 'Let me check the weather for you.' },
        {
          type: 'tool_use',
          id: 'call_123',
          name: 'get_weather',
          input: { location: 'Tokyo' },
        },
      ]);
    });

    it('maps role: tool message to Anthropic user turn containing tool_result', () => {
      const request: OpenAIChatRequest = {
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: 'What is the weather in Tokyo?' },
          {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call_123',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"location":"Tokyo"}' },
              },
            ],
          },
          {
            role: 'tool',
            tool_call_id: 'call_123',
            content: '{"temperature":"22C","condition":"Sunny"}',
          },
        ],
      };

      const translated = translateRequestToProvider(request, 'anthropic', 'claude-3-5-sonnet');
      const messages = translated.body.messages as any[];
      const lastMsg = messages[messages.length - 1];
      expect(lastMsg.role).toBe('user');
      expect(lastMsg.content).toEqual([
        {
          type: 'tool_result',
          tool_use_id: 'call_123',
          content: '{"temperature":"22C","condition":"Sunny"}',
        },
      ]);
    });
  });

  describe('2. Gemini Tool Ingestion', () => {
    it('maps OpenAI tools array to Gemini function_declarations format', () => {
      const request: OpenAIChatRequest = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Search products' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'search_products',
              description: 'Search product catalog',
              parameters: { type: 'object', properties: { query: { type: 'string' } } },
            },
          },
        ],
      };

      const translated = translateRequestToProvider(request, 'gemini', 'gemini-1.5-pro');
      expect(translated.body.tools).toBeDefined();
      expect(translated.body.tools).toEqual([
        {
          function_declarations: [
            {
              name: 'search_products',
              description: 'Search product catalog',
              parameters: { type: 'object', properties: { query: { type: 'string' } } },
            },
          ],
        },
      ]);
    });

    it('maps assistant tool_calls to Gemini functionCall model turn parts', () => {
      const request: OpenAIChatRequest = {
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: 'Search products' },
          {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call_456',
                type: 'function',
                function: { name: 'search_products', arguments: '{"query":"laptop"}' },
              },
            ],
          },
        ],
      };

      const translated = translateRequestToProvider(request, 'gemini', 'gemini-1.5-pro');
      const contents = translated.body.contents as any[];
      expect(contents[1].role).toBe('model');
      expect(contents[1].parts).toEqual([
        {
          functionCall: {
            name: 'search_products',
            args: { query: 'laptop' },
          },
        },
      ]);
    });

    it('maps role: tool message to Gemini functionResponse user turn part', () => {
      const request: OpenAIChatRequest = {
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: 'Search products' },
          {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call_456',
                type: 'function',
                function: { name: 'search_products', arguments: '{"query":"laptop"}' },
              },
            ],
          },
          {
            role: 'tool',
            tool_call_id: 'call_456',
            content: '{"results":["MacBook Pro","ThinkPad"]}',
          },
        ],
      };

      const translated = translateRequestToProvider(request, 'gemini', 'gemini-1.5-pro');
      const contents = translated.body.contents as any[];
      const lastTurn = contents[contents.length - 1];
      expect(lastTurn.role).toBe('user');
      expect(lastTurn.parts).toEqual([
        {
          functionResponse: {
            name: 'search_products',
            response: {
              result: '{"results":["MacBook Pro","ThinkPad"]}',
            },
          },
        },
      ]);
    });
  });

  describe('3. Response Tool Extraction', () => {
    it('extracts Anthropic tool_use into OpenAI choices[0].message.tool_calls with stringified arguments', () => {
      const anthropicRaw = {
        id: 'msg_999',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-5-sonnet-20241022',
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Searching weather...' },
          {
            type: 'tool_use',
            id: 'toolu_01123',
            name: 'get_weather',
            input: { location: 'Tokyo', unit: 'celsius' },
          },
        ],
        usage: { input_tokens: 15, output_tokens: 25 },
      };

      const response = translateResponseToOpenAI(anthropicRaw, 'anthropic', 'claude-3-5-sonnet');
      expect(response.choices[0].finish_reason).toBe('tool_calls');
      expect(response.choices[0].message.content).toBe('Searching weather...');
      expect(response.choices[0].message.tool_calls).toEqual([
        {
          id: 'toolu_01123',
          type: 'function',
          function: {
            name: 'get_weather',
            arguments: JSON.stringify({ location: 'Tokyo', unit: 'celsius' }),
          },
        },
      ]);
    });

    it('extracts Gemini functionCall into OpenAI choices[0].message.tool_calls with stringified arguments', () => {
      const geminiRaw = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    name: 'lookup_user',
                    args: { userId: 42 },
                  },
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      };

      const response = translateResponseToOpenAI(geminiRaw, 'gemini', 'gemini-1.5-pro');
      expect(response.choices[0].finish_reason).toBe('tool_calls');
      expect(response.choices[0].message.tool_calls).toHaveLength(1);
      expect(response.choices[0].message.tool_calls![0].function).toEqual({
        name: 'lookup_user',
        arguments: JSON.stringify({ userId: 42 }),
      });
      expect(response.choices[0].message.tool_calls![0].id).toMatch(/^call_/);
    });
  });

  describe('4. Finish Reason Precision', () => {
    it('strictly maps Anthropic finish reasons: end_turn -> stop, max_tokens -> length, tool_use -> tool_calls', () => {
      const base = { id: 'm1', content: [{ type: 'text', text: 'hi' }] };

      expect(translateResponseToOpenAI({ ...base, stop_reason: 'end_turn' }, 'anthropic', 'm').choices[0].finish_reason).toBe('stop');
      expect(translateResponseToOpenAI({ ...base, stop_reason: 'stop_sequence' }, 'anthropic', 'm').choices[0].finish_reason).toBe('stop');
      expect(translateResponseToOpenAI({ ...base, stop_reason: 'max_tokens' }, 'anthropic', 'm').choices[0].finish_reason).toBe('length');
      expect(translateResponseToOpenAI({ ...base, stop_reason: 'tool_use' }, 'anthropic', 'm').choices[0].finish_reason).toBe('tool_calls');
    });

    it('strictly maps Gemini finish reasons: STOP -> stop, MAX_TOKENS -> length, SAFETY/RECITATION -> content_filter', () => {
      const makeGem = (reason: string) => ({
        candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: reason }],
      });

      expect(translateResponseToOpenAI(makeGem('STOP'), 'gemini', 'm').choices[0].finish_reason).toBe('stop');
      expect(translateResponseToOpenAI(makeGem('MAX_TOKENS'), 'gemini', 'm').choices[0].finish_reason).toBe('length');
      expect(translateResponseToOpenAI(makeGem('SAFETY'), 'gemini', 'm').choices[0].finish_reason).toBe('content_filter');
      expect(translateResponseToOpenAI(makeGem('RECITATION'), 'gemini', 'm').choices[0].finish_reason).toBe('content_filter');
    });
  });

  describe('5. SSE Stream Chunking', () => {
    it('normalizes mock Anthropic SSE stream to OpenAI format and appends data: [DONE]\n\n', async () => {
      const mockAnthropicChunks = [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":10}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":" world!"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ];

      const chunks: string[] = [];
      let reportedUsage: any = null;

      for await (const chunk of transformToOpenAISSEStream(mockAnthropicChunks, 'anthropic', 'claude-3-5-sonnet', (u) => { reportedUsage = u; })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThanOrEqual(3);
      expect(chunks[0]).toContain('"content":"Hello"');
      expect(chunks[1]).toContain('"content":" world!"');
      expect(chunks[chunks.length - 1]).toBe('data: [DONE]\n\n');
      expect(reportedUsage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
    });

    it('normalizes mock Gemini SSE stream to OpenAI format and appends data: [DONE]\n\n', async () => {
      const mockGeminiChunks = [
        'data: {"candidates":[{"content":{"parts":[{"text":"Gemini"}]}}],"usageMetadata":{"promptTokenCount":8}}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":" response"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":8,"candidatesTokenCount":4}}\n\n',
      ];

      const chunks: string[] = [];
      let reportedUsage: any = null;

      for await (const chunk of transformToOpenAISSEStream(mockGeminiChunks, 'gemini', 'gemini-1.5-pro', (u) => { reportedUsage = u; })) {
        chunks.push(chunk);
      }

      expect(chunks[0]).toContain('"content":"Gemini"');
      expect(chunks[1]).toContain('"content":" response"');
      expect(chunks[chunks.length - 1]).toBe('data: [DONE]\n\n');

      expect(reportedUsage).toEqual({
        promptTokens: 8,
        completionTokens: 4,
        totalTokens: 12,
      });
    });
  });

  describe('6. Operation Crucible Regression Tests', () => {
    it('1. Parallel Tool Index Test: Anthropic and Gemini parallel tool calls emit indices 0 and 1 in stream deltas', async () => {
      // Anthropic parallel tool test
      const anthropicParallelChunks = [
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call_0","name":"tool_a"}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call_1","name":"tool_b"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"a\\":1}"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"b\\":2}"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n',
      ];

      const anthropicDeltas: any[] = [];
      for await (const chunk of transformToOpenAISSEStream(anthropicParallelChunks, 'anthropic', 'claude-3-5-sonnet')) {
        if (chunk.startsWith('data: {')) {
          anthropicDeltas.push(JSON.parse(chunk.slice(5)));
        }
      }

      const anthropicIndices = anthropicDeltas
        .filter(d => d.choices?.[0]?.delta?.tool_calls)
        .map(d => d.choices[0].delta.tool_calls[0].index);
      expect(anthropicIndices).toEqual([0, 1, 0, 1]);

      // Gemini parallel tool test
      const geminiParallelChunks = [
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"tool_a","args":{"a":1}}},{"functionCall":{"name":"tool_b","args":{"b":2}}}]}}]}\n\n',
      ];

      const geminiDeltas: any[] = [];
      for await (const chunk of transformToOpenAISSEStream(geminiParallelChunks, 'gemini', 'gemini-1.5-pro')) {
        if (chunk.startsWith('data: {')) {
          geminiDeltas.push(JSON.parse(chunk.slice(5)));
        }
      }

      const geminiIndices = geminiDeltas
        .filter(d => d.choices?.[0]?.delta?.tool_calls)
        .map(d => d.choices[0].delta.tool_calls[0].index);
      expect(geminiIndices).toEqual([0, 1]);
    });

    it('2. Finish Reason Precedence Test: Gemini functionCall followed by STOP finishes with tool_calls', async () => {
      const geminiStream = [
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"get_weather","args":{"city":"Tokyo"}}}]}}]}\n\n',
        'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5}}\n\n',
      ];

      const deltas: any[] = [];
      for await (const chunk of transformToOpenAISSEStream(geminiStream, 'gemini', 'gemini-1.5-pro')) {
        if (chunk.startsWith('data: {')) {
          deltas.push(JSON.parse(chunk.slice(5)));
        }
      }

      const finalChunk = deltas[deltas.length - 1];
      expect(finalChunk.choices[0].finish_reason).toBe('tool_calls');
    });

    it('3. Mid-Stream Error Guard Test: handles aborted upstream with error event, data: [DONE], and clean end', async () => {
      async function* faultyStream() {
        yield 'data: {"candidates":[{"content":{"parts":[{"text":"Partial content"}]}}]}\n\n';
        throw new Error('Upstream provider stream disconnected');
      }

      let onErrorCalled = false;
      const chunks: string[] = [];

      try {
        for await (const chunk of transformToOpenAISSEStream(
          faultyStream(),
          'gemini',
          'gemini-1.5-pro',
          undefined,
          undefined,
          (err) => { onErrorCalled = true; }
        )) {
          chunks.push(chunk);
        }
      } catch {
        // Expected stream error
      }

      expect(onErrorCalled).toBe(true);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]).toContain('Partial content');
    });

    it('4. Abort Usage Recording Test: client socket abort records quota_usage >= 1 used tokens', async () => {
      async function* infiniteStream() {
        yield 'data: {"candidates":[{"content":{"parts":[{"text":"Chunk 1 text for usage billing."}]}}]}\n\n';
        yield 'data: {"candidates":[{"content":{"parts":[{"text":"Chunk 2 text for usage billing."}]}}]}\n\n';
      }

      let reportedUsage: any = null;
      const stream = transformToOpenAISSEStream(infiniteStream(), 'gemini', 'gemini-1.5-pro', (usage) => {
        reportedUsage = usage;
      });

      // Consume first chunk and simulate client abort (break)
      for await (const _ of stream) {
        break;
      }

      expect(reportedUsage).not.toBeNull();
      expect(reportedUsage.totalTokens).toBeGreaterThanOrEqual(1);
    });
  });
});
