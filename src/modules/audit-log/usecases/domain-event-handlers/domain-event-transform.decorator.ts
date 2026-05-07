/* eslint-disable @typescript-eslint/no-explicit-any */
import { Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { DefaultTransformOptions, DefaultValidationOptions } from 'src/utils/config/validation.config';

export function DomainEventTransform<T extends { new (...args: any[]): any }>(payloadClass: T): ClassDecorator {
  return (target: any) => {
    const originalHandle = target.prototype.handle;
    const logger = new Logger(target.name);

    target.prototype.handle = async function (event: any): Promise<any> {
      const transformed = plainToInstance(payloadClass, event.payload, DefaultTransformOptions);

      const errors: ValidationError[] = await validate(transformed, {
        ...DefaultValidationOptions,
        stopAtFirstError: false,
      });

      if (errors.length > 0) {
        const messages = errors.map((error) => Object.values(error.constraints || {}).join(', ')).join('; ');

        logger.error(`Validation failed for ${payloadClass.name} in ${target.name}: ${messages}`, {
          event,
          errors,
        });

        throw DefaultValidationOptions.exceptionFactory?.(errors);
      }

      // eslint-disable-next-line require-atomic-updates
      event.payload = transformed;

      return originalHandle.apply(this, [event]);
    };

    return target;
  };
}
