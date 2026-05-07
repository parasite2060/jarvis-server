/* eslint-disable @typescript-eslint/no-explicit-any */
import { Exclude, instanceToPlain } from 'class-transformer';

export interface IValueObject {
  equals(valueObject: IValueObject): boolean;
}

export abstract class ValueObject<PropsType> implements IValueObject {
  @Exclude()
  protected readonly props: PropsType;

  constructor(props: PropsType) {
    this.validate(props);
    this.props = Object.freeze(props);
  }

  protected validate(props: PropsType) {
    if (props === undefined || props === null) {
      throw new Error(`${this.constructor.name} value object not accept null props`);
    }
  }

  public equals(valueObject: IValueObject): boolean {
    if (valueObject === null || valueObject === undefined) {
      return false;
    }
    return JSON.stringify(this.props) === JSON.stringify((valueObject as ValueObject<PropsType>).props);
  }

  public toJson(): string {
    return JSON.stringify(instanceToPlain(this));
  }

  public toPlain(): Record<string, any> {
    return instanceToPlain(this);
  }
}
