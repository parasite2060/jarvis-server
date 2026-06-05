import { HttpStatus } from '@nestjs/common';
import { BaseException, InternalException, ValidateException } from 'src/shared/common/models/exception';

export function getHttpCode(error: BaseException): HttpStatus | null {
  if (error instanceof ValidateException) {
    return HttpStatus.BAD_REQUEST;
  }

  if (error instanceof InternalException) {
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  return null;
}
