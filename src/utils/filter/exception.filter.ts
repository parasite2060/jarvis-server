/* eslint-disable @typescript-eslint/no-explicit-any */
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger, RpcExceptionFilter, UnauthorizedException } from '@nestjs/common';
import { HttpArgumentsHost, RpcArgumentsHost } from '@nestjs/common/interfaces/features/arguments-host.interface';
import { AbstractHttpAdapter } from '@nestjs/core';
import { Observable, of } from 'rxjs';
import { HttpApiResponse } from '../api-http.response';
import { RpcApiResponse } from '../api-rpc.response';
import { ErrorCode } from '../error.code';
import { ValidateException, InternalException } from 'src/shared/common/models/exception';
import { VaultFileNotFoundError } from 'src/shared/common/exceptions/vault-file-not-found.error';
import { VaultPathTraversalError } from 'src/shared/common/exceptions/vault-path-traversal.error';
import { MemuError, MemuUnavailableError } from 'src/shared/api/errors/memu.errors';

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
 * Vault read 404 — `GetSoul`/`GetIdentity`/`GetMemoryFile` use cases throw
 * `VaultFileNotFoundError` (Story 13.4). Mapped to HTTP 404 with the boilerplate-flat
 * envelope (Decision B). The Python wire on this 404 was the legacy nested
 * `{ error: { code, message }, status: 'error' }` shape (memory.py:92-98), but the
 * plugin's `getSoul`/`getIdentity`/`getMemory` only checks `!response.ok` and returns
 * `null` — so MC1 holds via the plugin's parse contract (story file N1).
 */
@Catch(VaultFileNotFoundError)
export class VaultFileNotFoundExceptionFilter implements ExceptionFilter {
  constructor(private readonly httpAdapter: AbstractHttpAdapter) {}

  catch(exception: VaultFileNotFoundError, host: ArgumentsHost): any {
    if (host.getType() !== 'http') return null;
    const ctx = host.switchToHttp();
    const body = HttpApiResponse.failed(exception.code, exception.message);
    this.httpAdapter.reply(ctx.getResponse(), body, HttpStatus.NOT_FOUND);
    return null;
  }
}

/**
 * Vault read 403 — `GetVaultFileUseCase` throws `VaultPathTraversalError`
 * (Story 13.4). NOT 404 — security: the caller learns the path is rejected
 * but not whether the file would have existed.
 */
@Catch(VaultPathTraversalError)
export class VaultPathTraversalExceptionFilter implements ExceptionFilter {
  constructor(private readonly httpAdapter: AbstractHttpAdapter) {}

  catch(exception: VaultPathTraversalError, host: ArgumentsHost): any {
    if (host.getType() !== 'http') return null;
    const ctx = host.switchToHttp();
    const body = HttpApiResponse.failed(exception.code, exception.message);
    this.httpAdapter.reply(ctx.getResponse(), body, HttpStatus.FORBIDDEN);
    return null;
  }
}

/**
 * MemU upstream error (Story 13.4 / AC #3 / AC #4). Preserves upstream HTTP status —
 * mirrors Python `_handle_memu_error` (memory.py:142-149).
 */
@Catch(MemuError)
export class MemuErrorExceptionFilter implements ExceptionFilter {
  constructor(private readonly httpAdapter: AbstractHttpAdapter) {}

  catch(exception: MemuError, host: ArgumentsHost): any {
    if (host.getType() !== 'http') return null;
    const ctx = host.switchToHttp();
    const body = HttpApiResponse.failed(ErrorCode.MEMU_ERROR, exception.detail);
    this.httpAdapter.reply(ctx.getResponse(), body, exception.statusCode);
    return null;
  }
}

/**
 * MemU unavailable (transport / 5xx exhausted). Always HTTP 502 — matches Python
 * `_handle_memu_unavailable` (memory.py:152-159).
 */
@Catch(MemuUnavailableError)
export class MemuUnavailableExceptionFilter implements ExceptionFilter {
  constructor(private readonly httpAdapter: AbstractHttpAdapter) {}

  catch(exception: MemuUnavailableError, host: ArgumentsHost): any {
    if (host.getType() !== 'http') return null;
    const ctx = host.switchToHttp();
    const body = HttpApiResponse.failed(ErrorCode.MEMU_UNAVAILABLE, exception.detail);
    this.httpAdapter.reply(ctx.getResponse(), body, HttpStatus.BAD_GATEWAY);
    return null;
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
