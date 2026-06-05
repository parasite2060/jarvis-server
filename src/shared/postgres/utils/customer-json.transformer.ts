/* eslint-disable @typescript-eslint/no-explicit-any */
import { ValueTransformer } from 'typeorm';

export class CustomJsonTransformer implements ValueTransformer {
  private parseJson(value: any): any {
    if (value && typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
      return JSON.parse(value);
    }
    return value;
  }

  to(value: any): any {
    return this.parseJson(value);
  }

  from(value: any): any {
    return this.parseJson(value);
  }
}
