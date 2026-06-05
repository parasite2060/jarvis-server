/* eslint-disable @typescript-eslint/no-explicit-any */
import { ValidationPipeOptions } from '@nestjs/common';
import { ClassTransformOptions } from 'class-transformer';
// @ts-expect-error - no type declaration for class-transformer internal storage
import { defaultMetadataStorage } from 'class-transformer/cjs/storage';
import { ValidationError } from 'class-validator';
import { ValidateException } from 'src/shared/common/models/exception';
import { ErrorCode } from '../error.code';

export const DefaultTransformOptions: ClassTransformOptions = {
  excludeExtraneousValues: false,
  exposeUnsetFields: false,
};

export const DefaultValidationOptions: ValidationPipeOptions = {
  whitelist: true,
  transform: true,
  stopAtFirstError: true,
  forbidNonWhitelisted: true,
  forbidUnknownValues: false,
  transformOptions: DefaultTransformOptions,
  validationError: {
    target: false,
    value: false,
  },
  exceptionFactory: (validationErrors: ValidationError[] = []) => {
    const error = validationErrors[0];
    if (!error) {
      return new ValidateException(ErrorCode.VALIDATION_FAILED, 'Unknown validation error');
    }
    let constraints = error.constraints;
    const hasChildrenConstraints = !constraints && error.children?.length;
    if (hasChildrenConstraints) {
      // For array validation
      constraints = error.children![0]!.constraints || error.children![0]?.children?.[0]?.constraints;
    }
    if (!constraints) {
      return new ValidateException(ErrorCode.VALIDATION_FAILED, 'Unknown validation error');
    }
    const constraintName = Object.keys(constraints)[0]!;
    let context = error?.contexts?.[constraintName] || {};
    if (hasChildrenConstraints) {
      // For array validation
      const contexts = error.children![0]!.contexts || error.children![0]?.children?.[0]?.contexts;
      context = contexts?.[constraintName] || {};
    }
    const code = (context['code'] as ErrorCode) || ErrorCode.VALIDATION_FAILED;
    const message = context['message'] || constraints[constraintName] || 'Validation failed';
    const exposedMessage = replaceMessageWithExposeName(error, message);

    return new ValidateException(code, exposedMessage);
  },
};

function replaceMessageWithExposeName(error: ValidationError, message: string): string {
  const exposeName = getExposeName(error.target, error.property);
  return message.replace(error.property, exposeName);
}

function getExposeName(target: any, propertyKey: string): string {
  if (!target) return propertyKey;
  const metadata = defaultMetadataStorage.findExposeMetadata(target.constructor, propertyKey);
  return metadata?.options?.name || propertyKey;
}
