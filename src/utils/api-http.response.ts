/* eslint-disable @typescript-eslint/no-explicit-any */
import { ErrorCode } from './error.code';

export class HttpApiResponse<T> {
  code!: ErrorCode;
  message!: string;
  data!: T;

  constructor(init?: Partial<HttpApiResponse<T>>) {
    Object.assign(this, init);
  }

  public static success<U>(data?: U): HttpApiResponse<U> {
    return new HttpApiResponse<U>({
      code: ErrorCode.SUCCESS,
      message: 'Success',
      data: data,
    });
  }

  public static failed(code: ErrorCode, message: string): HttpApiResponse<any> {
    return new HttpApiResponse<any>({
      code: code,
      message: message,
      data: null,
    });
  }

  public toString(): string {
    return JSON.stringify(this);
  }
}
