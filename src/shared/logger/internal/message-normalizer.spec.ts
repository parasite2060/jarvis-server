import { normalizeError, normalizeLog, normalizeWarn } from './message-normalizer';

const baseMeta = { requestId: 'req-1' };

describe('normalizeLog', () => {
  it('should keep primitive messages and merge baseMeta + caller', () => {
    const result = normalizeLog({ payload: 'hello', caller: 'X', baseMeta });

    expect(result).toEqual({
      meta: { requestId: 'req-1', caller: 'X' },
      message: 'hello',
    });
  });

  it('should split object payloads into meta + message', () => {
    const result = normalizeLog({ payload: { message: 'done', latency: 12 }, caller: 'X', baseMeta });

    expect(result).toEqual({
      meta: { requestId: 'req-1', caller: 'X', latency: 12 },
      message: 'done',
    });
  });

  it('should omit caller key when no caller is provided', () => {
    const result = normalizeLog({ payload: 'hi', baseMeta });

    expect(result.meta).toEqual({ requestId: 'req-1' });
  });
});

describe('normalizeError', () => {
  it('should extract message + stack from Error instance', () => {
    const err = new Error('boom');
    err.stack = 'STACK';

    const result = normalizeError({ payload: err, caller: 'Svc', baseMeta });

    expect(result.message).toBe('boom');
    expect(result.meta).toEqual(expect.objectContaining({ requestId: 'req-1', caller: 'Svc', stack: 'STACK' }));
  });

  it('should fall back to trace as stack when Error has none', () => {
    const err = new Error('boom');
    err.stack = undefined;

    const result = normalizeError({ payload: err, caller: 'Svc', trace: 'TRACE', baseMeta });

    expect(result.meta).toEqual(expect.objectContaining({ stack: 'TRACE' }));
  });

  it('should pull stack from nested Error inside an object payload', () => {
    const inner = new Error('inner');
    inner.stack = 'INNER_STACK';

    const result = normalizeError({ payload: { message: 'outer', error: inner, ctx: 1 }, caller: 'Svc', baseMeta });

    expect(result.message).toBe('outer');
    expect(result.meta).toEqual(expect.objectContaining({ caller: 'Svc', stack: 'INNER_STACK', ctx: 1 }));
    expect(result.meta).not.toHaveProperty('error');
  });

  it('should preserve non-Error nested error values', () => {
    const result = normalizeError({ payload: { message: 'outer', error: { code: 42 } }, caller: 'Svc', baseMeta });

    expect(result.meta).toEqual(expect.objectContaining({ error: { code: 42 } }));
  });

  it('should set stack to trace for primitive when caller is set', () => {
    const result = normalizeError({ payload: 'fail', caller: 'Svc', trace: 'TRACE', baseMeta });

    expect(result).toEqual({
      meta: { requestId: 'req-1', caller: 'Svc', stack: 'TRACE' },
      message: 'fail',
    });
  });

  it('should set stack to null for primitive with no caller and no trace', () => {
    const result = normalizeError({ payload: 'fail', baseMeta });

    expect(result.meta).toEqual({ requestId: 'req-1', stack: null });
  });

  it('should fall back to trace as caller for primitive when no caller is set', () => {
    const result = normalizeError({ payload: 'fail', trace: 'TRACE', baseMeta });

    expect(result.meta).toEqual({ requestId: 'req-1', caller: 'TRACE', stack: null });
  });

  it('should fall back to trace as caller when caller is omitted', () => {
    const err = new Error('boom');
    err.stack = 'S';

    const result = normalizeError({ payload: err, trace: 'TRACE', baseMeta });

    expect(result.meta).toEqual(expect.objectContaining({ caller: 'TRACE' }));
  });
});

describe('normalizeWarn', () => {
  it('should extract stack from nested Error', () => {
    const inner = new Error('rate-limited');
    inner.stack = 'RL_STACK';

    const result = normalizeWarn({ payload: { message: 'soft', error: inner, attempt: 2 }, caller: 'Svc', baseMeta });

    expect(result.meta).toEqual(expect.objectContaining({ stack: 'RL_STACK', attempt: 2 }));
    expect(result.message).toBe('soft');
  });

  it('should pass through object meta when no nested error', () => {
    const result = normalizeWarn({ payload: { message: 'slow', latency: 999 }, caller: 'Svc', baseMeta });

    expect(result.meta).toEqual({ requestId: 'req-1', caller: 'Svc', latency: 999 });
  });

  it('should handle primitive messages', () => {
    const result = normalizeWarn({ payload: 'low memory', caller: 'Svc', baseMeta });

    expect(result).toEqual({
      meta: { requestId: 'req-1', caller: 'Svc' },
      message: 'low memory',
    });
  });
});
