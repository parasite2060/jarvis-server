/* eslint-disable @typescript-eslint/no-explicit-any */
import { ErrorCode } from './error.code';

export class ApiResponse<T> {
  status!: number;
  code!: ErrorCode;
  message!: string;
  data!: T;

  constructor(init?: Partial<ApiResponse<T>>) {
    Object.assign(this, init);
  }

  public static success<U>(data?: U): ApiResponse<U> {
    return new ApiResponse<U>({
      code: ErrorCode.SUCCESS,
      message: 'Success',
      data: data,
    });
  }

  public static failed(status: number, code: ErrorCode, message: string): ApiResponse<any> {
    return new ApiResponse<any>({
      status: status,
      code: code,
      message: message,
      data: null,
    });
  }

  public static badRequest(code: ErrorCode, message: string): ApiResponse<any> {
    return new ApiResponse<any>({
      status: 400,
      code: code,
      message: message,
      data: null,
    });
  }

  public static internalError(code: ErrorCode, message: string): ApiResponse<any> {
    return new ApiResponse<any>({
      status: 500,
      code: code,
      message: message,
      data: null,
    });
  }
}
