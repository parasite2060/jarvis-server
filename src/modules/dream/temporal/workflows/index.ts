export { dreamCoordinatorWorkflow, submitLightSignal, submitDeepSignal, submitWeeklySignal } from './dream-coordinator.workflow';
export type { DreamKind, DreamRequest } from './dream-coordinator.workflow';
export { lightDreamWorkflow, deriveSourceDate, deriveSessionStart } from './light-dream.workflow';
export { deepDreamWorkflow, formatPhase1Summary, formatPhase2Summary, extractKnowledgeGapNames } from './deep-dream.workflow';
export { weeklyReviewWorkflow } from './weekly-review.workflow';

// Story 13.10 / Q1 (RESOLVED 2026-05-08, refined post-Worker.create-typecheck):
// `@temporalio/worker@1.17.0` registers workflows by their EXPORTED function
// NAME, not via an explicit `workflows: { wireName: fn }` map (the option
// the SM-default Q1 = Option A assumed exists in this SDK version does not).
// To register the camelCase TS function `lightDreamWorkflow` under the
// PascalCase wire name `LightDream` (frozen by MC3), re-export it via an
// alias. The bundle generated from this directory exposes BOTH names; the
// coordinator's `executeChild('LightDream', ...)` resolves the alias.
//
// Stories 13.11 / 13.12 add `DeepDream` / `WeeklyReview` aliases the same way.
export { lightDreamWorkflow as LightDream } from './light-dream.workflow';
export { deepDreamWorkflow as DeepDream } from './deep-dream.workflow';
export { weeklyReviewWorkflow as WeeklyReview } from './weekly-review.workflow';

// Story 13.13 — schedule relay workflow (sandbox-clean). Wire name
// `ScheduleSignalRelay` per Python `@workflow.defn(name="ScheduleSignalRelay")`.
export { scheduleSignalRelayWorkflow as ScheduleSignalRelay } from './schedule-signal-relay.workflow';
