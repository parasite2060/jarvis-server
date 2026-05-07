import { Provider } from '@nestjs/common';
import { KAFKA_API } from 'src/shared/domain/apis/kafka.api';
import { KafkaApiService } from './kafka-api.service';

export const Apis: Provider[] = [
  {
    provide: KAFKA_API,
    useClass: KafkaApiService,
  },
];
