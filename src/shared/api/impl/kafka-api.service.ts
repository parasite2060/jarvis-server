import { Injectable, Logger } from '@nestjs/common';
import { KafkaApi, KafkaEvent } from 'src/shared/domain/apis/kafka.api';

@Injectable()
export class KafkaApiService implements KafkaApi {
  private readonly logger = new Logger(KafkaApiService.name);

  async emit(event: KafkaEvent): Promise<void> {
    // Jarvis MVP does not publish to Kafka (architecture.md §6.8).
    // Domain events remain in-process only via EventBus.
    this.logger.debug({ event: 'kafkaApi.emit.disabled', topic: event.topic, key: event.key });
  }
}
