export const CLOUD_TRACE_HEADERS = [
  'grpc-trace-bin',
  'x-request-id',
  'x-cloud-trace-context',
  'x-datadog-trace-id',
  'x-b3-traceid',
  'x-b3-spanid',
  'x-b3parentspanid',
  'x-b3-sampled',
  'x-b3-flags',
  'traceparent',
] as const;
