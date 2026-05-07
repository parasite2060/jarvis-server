import { Inject, Injectable } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { instanceToPlain } from 'class-transformer';
import { firstValueFrom } from 'rxjs';
import { KAFKA_CLIENT } from 'src/utils/config';
import { KafkaApi, KafkaEvent } from 'src/shared/domain/apis/kafka.api';

@Injectable()
export class KafkaApiService implements KafkaApi {
  constructor(
    @Inject(KAFKA_CLIENT)
    private readonly kafkaClient: ClientKafka,
  ) {}

  async emit(event: KafkaEvent): Promise<void> {
    await firstValueFrom(
      this.kafkaClient.emit(event.topic, {
        key: event.key || null,
        headers: event.headers || {},
        value: instanceToPlain(event.data),
      }),
    );
  }
}
