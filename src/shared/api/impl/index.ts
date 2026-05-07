import { Provider } from '@nestjs/common';
import { KAFKA_API } from 'src/shared/domain/apis/kafka.api';
import { MEMU_API } from 'src/shared/domain/apis/memu-api.interface';
import { KafkaApiService } from './kafka-api.service';
import { MemuApiService } from './memu-api.service';

export const Apis: Provider[] = [
  {
    provide: KAFKA_API,
    useClass: KafkaApiService,
  },
  {
    provide: MEMU_API,
    useClass: MemuApiService,
  },
];
