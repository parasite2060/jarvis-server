import { Global, Module } from '@nestjs/common';
import { SecretScrubberService } from './secret-scrubber.service';

@Global()
@Module({
  providers: [SecretScrubberService],
  exports: [SecretScrubberService],
})
export class SecretRedactionModule {}
