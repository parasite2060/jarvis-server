/**
 * ActivityRegistry — walks the NestJS DI container and builds the activity
 * map consumed by `TemporalWorkerService.start({ activities: ... })`.
 *
 * Per design/temporal-workflows.md §3.2 + §3.3 — activities are NestJS
 * providers; registration is decorator-driven (no static `ACTIVITIES` array
 * per module). Story 13.8 ships the discovery infrastructure; Stories
 * 13.10/13.11/13.12 register activities via `@TemporalActivity('name')`.
 *
 * Activity names are MC3 wire-frozen; duplicate names hard-fail at collect
 * time (`InternalException(UNKNOWN, 'Duplicate activity name: <name>')`)
 * because the runtime mapping `{ name: boundFn }` requires uniqueness.
 */
import { Injectable, INestApplication, Logger } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import { TEMPORAL_ACTIVITY_METADATA, TemporalActivityMeta } from './decorators/temporal-activity.decorator';

export type ActivityFn = (input: unknown) => Promise<unknown>;
export type ActivityMap = Record<string, ActivityFn>;

@Injectable()
export class ActivityRegistry {
  private readonly logger = new Logger(ActivityRegistry.name);

  collect(app: INestApplication): ActivityMap {
    const discovery = app.get(DiscoveryService);
    const scanner = app.get(MetadataScanner);
    const providers = discovery.getProviders();
    const activities: ActivityMap = {};
    let providersScanned = 0;

    for (const wrapper of providers) {
      const instance = wrapper.instance as Record<string, unknown> | null | undefined;
      if (!instance || typeof instance !== 'object') continue;
      const prototype = Object.getPrototypeOf(instance) as object | null;
      if (!prototype) continue;
      providersScanned += 1;

      scanner.scanFromPrototype(instance, prototype, (methodName: string) => {
        const meta = Reflect.getMetadata(TEMPORAL_ACTIVITY_METADATA, prototype, methodName) as TemporalActivityMeta | undefined;
        if (!meta) return;
        if (meta.name in activities) {
          throw new InternalException(ErrorCode.UNKNOWN, `Duplicate activity name: ${meta.name}`);
        }
        const method = (instance as Record<string, unknown>)[methodName];
        if (typeof method !== 'function') return;
        activities[meta.name] = (method as (...args: unknown[]) => Promise<unknown>).bind(instance);
      });
    }

    this.logger.log({
      message: 'temporal activity registry collected',
      event: 'activityRegistry.collect.completed',
      activitiesCount: Object.keys(activities).length,
      providersScanned,
    });

    return activities;
  }
}
