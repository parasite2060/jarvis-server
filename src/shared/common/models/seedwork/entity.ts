/* eslint-disable @typescript-eslint/no-explicit-any */
import { Exclude, Expose, instanceToPlain } from 'class-transformer';
import { ReadonlyDefaultEntity } from 'src/utils/type.utils';

export interface IEntity {
  equals(entity: IEntity): boolean;
}

export abstract class Entity<T> implements IEntity {
  @Exclude()
  protected _id!: T;

  @Expose()
  public get id() {
    return this._id;
  }

  public equals(entity: Entity<T> | ReadonlyDefaultEntity<Entity<T>>): boolean {
    if (entity === null || entity === undefined) {
      return false;
    }

    if (this === entity) {
      return true;
    }

    return this.id === (entity as Entity<T>).id;
  }

  public toJson(): string {
    return JSON.stringify(instanceToPlain(this));
  }

  public toPlain(): Record<string, any> {
    return instanceToPlain(this);
  }
}
