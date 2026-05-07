/* eslint-disable @typescript-eslint/no-explicit-any */
import { IEntity } from 'src/shared/common/models/seedwork/entity';

export type NonFunctionPropertyNames<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any ? never : K;
}[keyof T];

export type FunctionPropertyNames<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => any ? K : never;
}[keyof T];

export type ReadonlyEntity<T extends IEntity, K extends keyof T> = Pick<T, NonFunctionPropertyNames<T> | 'equals' | K>;
export type ReadonlyDefaultEntity<T extends IEntity> = Pick<T, NonFunctionPropertyNames<T> | 'equals'>;
