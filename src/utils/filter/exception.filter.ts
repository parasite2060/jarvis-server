/* eslint-disable @typescript-eslint/no-explicit-any */
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger, RpcExceptionFilter, UnauthorizedException } from '@nestjs/common';
import { HttpArgumentsHost, RpcArgumentsHost } from '@nestjs/common/interfaces/features/arguments-host.interface';
import { AbstractHttpAdapter } from '@nestjs/core';
import { Observable, of } from 'rxjs';
import { HttpApiResponse } from '../api-http.response';
import { RpcApiResponse } from '../api-rpc.response';
import { ErrorCode } from '../error.code';
import { ValidateException, InternalException } from 'src/shared/common/models/exception';

/**
 * Validate exception filter.
 * Gets an ValidateException in code and creates an error response
 */
@Catch(ValidateException)
export class DefaultValidateExceptionFilter implements RpcExceptionFilter<ValidateException> {
  constructor(private readonly httpAdapter: AbstractHttpAdapter) {}

  catch(exception: ValidateException, host: ArgumentsHost): Observable<HttpApiResponse<any>> {
    if (host.getType() === 'http') {
      return httpValidateExceptionHandler(this.httpAdapter, host.switchToHttp(), exception);
    }

    return rpcValidateExceptionHandler(host.switchToRpc(), exception);
  }
}

/**
 * Internal exception filter
 * Gets an InternalException in code and creates an error response
 */
@Catch(InternalException)
export class DefaultInternalExceptionFilter implements RpcExceptionFilter<InternalException> {
  constructor(private readonly httpAdapter: AbstractHttpAdapter) {}

  catch(exception: InternalException, host: ArgumentsHost): Observable<HttpApiResponse<any>> {
    if (host.getType() === 'http') {
      return httpInternalExceptionHandler(this.httpAdapter, host.switchToHttp(), exception);
    }

    return rpcInternalExceptionHandler(host.switchToRpc(), exception);
  }
}

/**
 * Unauthorized exception filter
 * Gets an UnauthorizedException in code and creates an error response
 */
@Catch(UnauthorizedException)
export class DefaultUnauthorizedExceptionFilter implements RpcExceptionFilter<UnauthorizedException> {
  constructor(private readonly httpAdapter: AbstractHttpAdapter) {}

  catch(exception: UnauthorizedException, host: ArgumentsHost): Observable<HttpApiResponse<any>> {
    if (host.getType() === 'http') {
      return httpUnauthorizetExceptionHandler(this.httpAdapter, host.switchToHttp(), exception);
    }

    return rpcUnanthorizeExceptionHandler(host.switchToRpc(), exception);
  }
}

@Catch(HttpException)
export class HttpExceptionFilter implements RpcExceptionFilter<HttpException> {
  constructor(private readonly httpAdapter: AbstractHttpAdapter) {}

  catch(exception: HttpException, host: ArgumentsHost): Observable<HttpApiResponse<any>> {
    if (host.getType() === 'http') {
      return httpHttpExceptionHandler(this.httpAdapter, host.switchToHttp(), exception);
    }

    return rpcUnknownExceptionHandler(host.switchToRpc(), exception);
  }
}

/**
 * Unhandle error exception filter
 * Gets an Unhandle Exception in code and creates an error response
 */
@Catch()
export class UnknownExceptionsFilter implements ExceptionFilter {
  constructor(private readonly httpAdapter: AbstractHttpAdapter) {}

  catch(exception: unknown, host: ArgumentsHost): any {
    if (host.getType() === 'http') {
      return httpUnknownExceptionHandler(this.httpAdapter, host.switchToHttp(), exception);
    }

    return rpcUnknownExceptionHandler(host.switchToRpc(), exception);
  }
}

function httpHttpExceptionHandler(httpAdapter: AbstractHttpAdapter, context: HttpArgumentsHost, exception: HttpException): any {
  const responseBody = HttpApiResponse.failed(ErrorCode.UNKNOWN, exception.message);
  httpAdapter.reply(context.getResponse(), responseBody, exception.getStatus());
  return null;
}

function httpValidateExceptionHandler(httpAdapter: AbstractHttpAdapter, context: HttpArgumentsHost, exception: ValidateException): any {
  const responseBody = HttpApiResponse.failed(exception.code, exception.message);
  httpAdapter.reply(context.getResponse(), responseBody, 400);
  return null;
}

function httpInternalExceptionHandler(httpAdapter: AbstractHttpAdapter, context: HttpArgumentsHost, exception: InternalException): any {
  const responseBody = HttpApiResponse.failed(exception.code, exception.message);
  httpAdapter.reply(context.getResponse(), responseBody, 500);
  return null;
}

function httpUnknownExceptionHandler(httpAdapter: AbstractHttpAdapter, context: HttpArgumentsHost, exception: unknown): any {
  let httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
  if (exception instanceof HttpException) {
    httpStatus = exception.getStatus();
    Logger.warn({ message: 'httpUnknownExceptionHandler', data: exception.getResponse() });
  }
  const responseBody = HttpApiResponse.failed(ErrorCode.UNKNOWN, 'Unhandle exception');
  httpAdapter.reply(context.getResponse(), responseBody, httpStatus);

  return null;
}

function httpUnauthorizetExceptionHandler(httpAdapter: AbstractHttpAdapter, context: HttpArgumentsHost, _exception: UnauthorizedException): any {
  const responseBody = HttpApiResponse.failed(ErrorCode.UNAUTHORIZED, 'Unauthorized');
  httpAdapter.reply(context.getResponse(), responseBody, 401);
  return null;
}

function rpcValidateExceptionHandler(_ctx: RpcArgumentsHost, exception: ValidateException): Observable<RpcApiResponse<any>> {
  return of(RpcApiResponse.badRequest(exception.code, exception.message));
}

function rpcInternalExceptionHandler(_ctx: RpcArgumentsHost, exception: InternalException): Observable<RpcApiResponse<any>> {
  return of(RpcApiResponse.internalError(exception.code, exception.message));
}

function rpcUnknownExceptionHandler(_ctx: RpcArgumentsHost, _exception: unknown): Observable<RpcApiResponse<any>> {
  return of(RpcApiResponse.internalError(ErrorCode.UNKNOWN, 'unknown exception'));
}
function rpcUnanthorizeExceptionHandler(_ctx: RpcArgumentsHost, _exception: UnauthorizedException): Observable<RpcApiResponse<any>> {
  return of(RpcApiResponse.internalError(ErrorCode.UNAUTHORIZED, 'Unauthorized'));
}
