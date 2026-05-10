/**
 * Smoke E2E test for api-mock-server.
 *
 * Registers a stub via the control API, then POSTs directly to the mock
 * server's OpenAI-compatible endpoint. No NestJS app bootstrap required —
 * this test exercises the wiring end-to-end at the HTTP level.
 *
 * Requires API_MOCK_URL to be set (defaults to http://localhost:11435).
 */
import { ApiMockHelper } from './helpers';

const API_MOCK_URL = process.env['API_MOCK_URL'] ?? 'http://localhost:11435';

describe('api-mock-server smoke test', () => {
  const mock = new ApiMockHelper();

  beforeEach(async () => {
    await mock.clear();
  });

  it('registers a stub and returns it when the endpoint is called', async () => {
    // Arrange — register a stub that matches any POST to /v1/chat/completions
    const { id } = await mock.register({
      matchers: [
        { field: 'url', op: 'contains', value: '/chat/completions' },
        { field: 'method', op: 'exact', value: 'POST' },
      ],
      response: {
        status: 200,
        body: {
          id: 'chatcmpl-smoke-001',
          object: 'chat.completion',
          model: 'stub',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Hello from stub' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        },
      },
      times: 1,
    });

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    // Act — call the mock server's /v1/chat/completions directly
    const res = await fetch(`${API_MOCK_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify({
        model: 'stub',
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });

    // Assert
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      choices: Array<{ message: { content: string } }>;
    };
    expect(body.id).toBe('chatcmpl-smoke-001');
    expect(body.choices[0].message.content).toBe('Hello from stub');
  });

  it('returns 503 when no stub is registered', async () => {
    // No stubs — clear was called in beforeEach
    const res = await fetch(`${API_MOCK_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'stub', messages: [] }),
    });

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('no_matching_stub');
  });

  it('stub with times:1 is consumed after one hit', async () => {
    await mock.register({
      matchers: [
        { field: 'url', op: 'contains', value: '/chat/completions' },
        { field: 'method', op: 'exact', value: 'POST' },
      ],
      response: { status: 200, body: { hit: 1 } },
      times: 1,
    });

    const first = await fetch(`${API_MOCK_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${API_MOCK_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    });
    expect(second.status).toBe(503);
  });
});
