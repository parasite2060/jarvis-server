export type LogMeta = Record<string, unknown>;

export interface NormalizedLog {
  meta: LogMeta;
  message: string;
}

export interface NormalizeArgs {
  payload: unknown;
  caller?: string;
  trace?: string;
  baseMeta: LogMeta;
}

export function normalizeLog({ payload, caller, baseMeta }: NormalizeArgs): NormalizedLog {
  const callerMeta = caller ? { caller } : {};

  if (typeof payload === 'object' && payload !== null) {
    const { message, ...rest } = payload as { message?: unknown } & LogMeta;
    return {
      meta: { ...baseMeta, ...callerMeta, ...rest },
      message: String(message ?? ''),
    };
  }

  return {
    meta: { ...baseMeta, ...callerMeta },
    message: String(payload),
  };
}

export function normalizeError({ payload, caller, trace, baseMeta }: NormalizeArgs): NormalizedLog {
  const resolvedCaller = caller ?? trace;
  const callerMeta = resolvedCaller ? { caller: resolvedCaller } : {};

  if (payload instanceof Error) {
    const { message, stack } = payload;
    const errorMeta = extractEnumerableErrorProps(payload);
    return {
      meta: { ...baseMeta, ...callerMeta, stack: stack ?? trace, ...errorMeta },
      message: message,
    };
  }

  if (typeof payload === 'object' && payload !== null) {
    const { message, error, ...rest } = payload as { message?: unknown; error?: unknown } & LogMeta;

    if (error instanceof Error) {
      return {
        meta: {
          ...baseMeta,
          ...callerMeta,
          stack: error.stack ?? (caller ? trace : null),
          ...rest,
        },
        message: String(message ?? ''),
      };
    }

    return {
      meta: {
        ...baseMeta,
        ...callerMeta,
        stack: caller ? trace : null,
        error,
        ...rest,
      },
      message: String(message ?? ''),
    };
  }

  return {
    meta: { ...baseMeta, ...callerMeta, stack: caller ? trace : null },
    message: String(payload),
  };
}

export function normalizeWarn({ payload, caller, baseMeta }: NormalizeArgs): NormalizedLog {
  const callerMeta = caller ? { caller } : {};

  if (typeof payload === 'object' && payload !== null) {
    const { message, error, ...rest } = payload as { message?: unknown; error?: unknown } & LogMeta;

    if (error instanceof Error) {
      return {
        meta: { ...baseMeta, ...callerMeta, stack: error.stack, ...rest },
        message: String(message ?? ''),
      };
    }

    return {
      meta: { ...baseMeta, ...callerMeta, ...rest },
      message: String(message ?? ''),
    };
  }

  return {
    meta: { ...baseMeta, ...callerMeta },
    message: String(payload),
  };
}

function extractEnumerableErrorProps(error: Error): LogMeta {
  const meta: LogMeta = {};
  for (const key of Object.keys(error)) {
    if (key === 'message' || key === 'name' || key === 'stack') continue;
    meta[key] = (error as unknown as LogMeta)[key];
  }
  return meta;
}
