/* eslint-disable @typescript-eslint/no-explicit-any */
export const KAFKA_API = 'KAFKA_API';

export interface KafkaEvent {
  topic: string;
  key?: string;
  headers?: Record<string, string>;
  data: any;
}

export interface KafkaApi {
  emit(event: KafkaEvent): Promise<void>;
}
