import { HttpModule } from '@nestjs/axios';
import { Global, Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { Apis } from './impl';
import { KAFKA_CLIENT, configKafkaEventFactory } from 'src/utils/config';
import { AppConfigService } from '../config/config.service';

@Global()
@Module({
  imports: [
    HttpModule,
    ClientsModule.registerAsync([
      {
        name: KAFKA_CLIENT,
        useFactory: configKafkaEventFactory,
        inject: [AppConfigService],
      },
    ]),
  ],
  providers: [...Apis],
  exports: [...Apis],
})
export class ApiModule {}
