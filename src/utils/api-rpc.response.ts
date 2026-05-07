/* eslint-disable @typescript-eslint/no-explicit-any */
import { ErrorCode } from './error.code';

export class RpcApiResponse<T> {
  status!: number;
  code!: ErrorCode;
  message!: string;
  data!: T;

  constructor(init?: Partial<RpcApiResponse<T>>) {
    Object.assign(this, init);
  }

  public static success<U>(data?: U): RpcApiResponse<U> {
    return new RpcApiResponse<U>({
      status: 200,
      code: ErrorCode.SUCCESS,
      message: 'Success',
      data: data,
    });
  }

  public static failed(status: number, code: ErrorCode, message: string): RpcApiResponse<any> {
    return new RpcApiResponse<any>({
      status: status,
      code: code,
      message: message,
      data: null,
    });
  }

  public static badRequest(code: ErrorCode, message: string): RpcApiResponse<any> {
    return new RpcApiResponse<any>({
      status: 400,
      code: code,
      message: message,
      data: null,
    });
  }

  public static internalError(code: ErrorCode, message: string): RpcApiResponse<any> {
    return new RpcApiResponse<any>({
      status: 500,
      code: code,
      message: message,
      data: null,
    });
  }

  public toString(): string {
    return JSON.stringify(this);
  }
}
