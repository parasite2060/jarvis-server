/**
 * `@TemporalActivity(name?)` — method decorator marking a NestJS provider
 * method as a Temporal activity (Story 13.8).
 *
 * The wire activity name (passed to `Worker.create({ activities: { ... } })`
 * and referenced via `proxyActivities<{ name: ... }>()` in workflow code)
 * is either the explicit `name` argument OR the method name itself.
 *
 * `ActivityRegistry.collect(app)` walks every Nest provider, scans methods
 * for this metadata, and builds a flat `{ name: boundFn }` map for the
 * worker. Per design/temporal-workflows.md §3.2 + §3.3.
 *
 * Activity names are MC3 wire-frozen — duplicates across providers are bugs
 * and the registry hard-fails on collect.
 */
import 'reflect-metadata';

export const TEMPORAL_ACTIVITY_METADATA = Symbol('temporalActivity');

export interface TemporalActivityMeta {
  name: string;
}

export const TemporalActivity = (name?: string): MethodDecorator => {
  return (target, propertyKey, descriptor) => {
    const resolvedName = name ?? String(propertyKey);
    Reflect.defineMetadata(TEMPORAL_ACTIVITY_METADATA, { name: resolvedName } satisfies TemporalActivityMeta, target, propertyKey);
    return descriptor;
  };
};
