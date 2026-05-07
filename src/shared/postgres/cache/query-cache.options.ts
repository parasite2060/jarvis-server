/* eslint-disable @typescript-eslint/no-explicit-any */
import { CacheLifeTime } from './cache-life.enum';
import { CacheType } from './cache-type.enum';

export class CacheOptions {
  enable?: boolean = true;
  type?: CacheType;
  lifeTime?: CacheLifeTime;
  prefix?: any;
  duration?: number;
}

export class DefaultCacheOptions {
  type?: CacheType = CacheType.REDIS;
  lifeTime?: CacheLifeTime = CacheLifeTime.FIX_TIME;
  duration?: number;
}
