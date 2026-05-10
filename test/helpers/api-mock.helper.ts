export interface MatcherDef {
  field: 'url' | 'method' | 'body' | 'header' | 'fn';
  op?: string;
  value?: string;
  path?: string;
  match?: string;
  name?: string;
}

export interface MockStubInput {
  id?: string;
  matchers: MatcherDef[];
  response: { status: number; body: unknown; headers?: Record<string, string>; delay_ms?: number };
  times?: number;
  priority?: number;
}

export class ApiMockHelper {
  private readonly baseUrl = process.env['API_MOCK_URL'] ?? 'http://localhost:11435';

  async register(stub: MockStubInput): Promise<{ id: string }> {
    const res = await fetch(`${this.baseUrl}/mock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stub),
    });
    if (!res.ok) throw new Error(`ApiMockHelper.register failed: ${res.status}`);
    return res.json() as Promise<{ id: string }>;
  }

  async clear(): Promise<void> {
    await fetch(`${this.baseUrl}/mock`, { method: 'DELETE' });
  }
}
