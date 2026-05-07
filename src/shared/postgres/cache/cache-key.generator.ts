/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable eqeqeq */
import { CacheOptions, DefaultCacheOptions } from './query-cache.options';
import { createHash } from 'crypto';

export function cacheConfigFactory(tableName: string, defaultOptions?: DefaultCacheOptions) {
  return (funcName: string, args: any[], options?: CacheOptions) => {
    return cacheConfigs(tableName, funcName, args, options, defaultOptions);
  };
}

export function cacheConfigs(
  tableName: string,
  funcName: string,
  args: any[],
  options?: CacheOptions,
  defaultOptions?: DefaultCacheOptions,
): boolean | { id: any; milliseconds: number } {
  if (options) {
    options = Object.assign(new CacheOptions(), options);
    defaultOptions = Object.assign(new DefaultCacheOptions(), defaultOptions);

    return {
      id: `${options.type ?? defaultOptions?.type}:${options.lifeTime ?? defaultOptions?.lifeTime}:${tableName}:${funcName}:${
        options.prefix
      }:${generateArgKeys(args)}`,
      milliseconds: (options.duration ?? defaultOptions?.duration)!,
    };
  }

  return false;
}

function generateArgKeys(args: any[]): string {
  const cacheArgs: string[] = [];
  for (const arg of args) {
    const result = geneateArgKey(arg);
    if (result !== null) {
      cacheArgs.push(result);
    }
  }

  return cacheArgs.filter((x) => x != null).join(':');
}

function geneateArgKey(arg: any): string | null {
  if (typeof arg === 'function') {
    return null;
  }

  if (arg instanceof CacheOptions) {
    return null;
  }

  if (typeof arg === 'string') {
    return arg;
  }

  if (Array.isArray(arg)) {
    return arg.map((x) => geneateArgKey(x)).join(',');
  }

  if (typeof arg === 'object') {
    return createHash('sha256').update(JSON.stringify(arg)).digest('hex');
  }

  return arg + '';
}
