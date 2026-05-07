/* eslint-disable @typescript-eslint/no-explicit-any */
import { Logger } from '@nestjs/common';
import { ErrorCode } from './error.code';
import { ValidateException, InternalException } from 'src/shared/common/models/exception';
import { HttpApiResponse } from './api-http.response';
import { RpcApiResponse } from './api-rpc.response';

export function defaultHttpExceptionHandler(logger: Logger, err: any, code: ErrorCode, message: string): HttpApiResponse<any> {
  if (err instanceof ValidateException || err instanceof InternalException) {
    throw err;
  }

  logger.error({
    message: message,
    error: err,
  });

  return HttpApiResponse.failed(code, message);
}

export function defaultGrpcExceptionHandler(logger: Logger, err: any, code: ErrorCode, message: string): RpcApiResponse<any> {
  if (err instanceof ValidateException || err instanceof InternalException) {
    throw err;
  }

  logger.error({
    message: message,
    error: err,
  });

  return RpcApiResponse.internalError(code, message);
}
