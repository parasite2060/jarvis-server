/**
 * Unit spec for countUserMessages — the short-session gate that decides
 * whether the light-dream extraction agent runs. The plugin sends raw Claude
 * Code JSONL, so the previous plaintext `User:` regex counted zero and every
 * real session was skipped (no extraction, no PR). These tests pin the JSONL
 * counting and the plaintext fallback.
 */
import { countUserMessages, SHORT_SESSION_THRESHOLD } from './helpers';

describe('countUserMessages', () => {
  it('counts JSONL user turns with string content', () => {
    const jsonl = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'first question' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'answer' } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'second question' } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'third question' } }),
    ].join('\n');

    expect(countUserMessages(jsonl)).toBe(3);
  });

  it('excludes tool_result user lines (they carry type=user but are not turns)', () => {
    const jsonl = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'real turn' } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'output' }] } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'more output' }] } }),
    ].join('\n');

    // Only the string-content line counts; the two tool_result lines do not.
    expect(countUserMessages(jsonl)).toBe(1);
  });

  it('counts a user content array that has no tool_result as a turn', () => {
    const jsonl = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } });
    expect(countUserMessages(jsonl)).toBe(1);
  });

  it('ignores non-JSON and metadata lines', () => {
    const jsonl = [
      JSON.stringify({ type: 'mode', mode: 'normal' }),
      JSON.stringify({ type: 'file-history-snapshot', snapshot: {} }),
      'not json at all',
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'only real turn' } }),
    ].join('\n');

    expect(countUserMessages(jsonl)).toBe(1);
  });

  it('falls back to the plaintext User: regex when there is no JSONL', () => {
    const plain = ['[2026-06-06] User: hello', 'Assistant: hi', 'User: follow up'].join('\n');
    expect(countUserMessages(plain)).toBe(2);
  });

  it('returns 0 for an empty transcript', () => {
    expect(countUserMessages('')).toBe(0);
  });

  it('a real multi-turn JSONL session clears the short-session threshold', () => {
    const turns = Array.from({ length: 5 }, (_, i) => JSON.stringify({ type: 'user', message: { role: 'user', content: `turn ${i}` } }));
    const toolNoise = Array.from({ length: 20 }, () => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } }));
    const transcript = [...turns, ...toolNoise].join('\n');

    expect(countUserMessages(transcript)).toBe(5);
    expect(countUserMessages(transcript)).toBeGreaterThanOrEqual(SHORT_SESSION_THRESHOLD);
  });
});
