import { HttpModule } from '@nestjs/axios';
import { Global, Module } from '@nestjs/common';
import { Apis } from './impl';

@Global()
@Module({
  imports: [HttpModule],
  providers: [...Apis],
  exports: [...Apis],
})
export class ApiModule {}
