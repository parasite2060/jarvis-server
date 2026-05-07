import { AggregateRoot as BaseAggregateRoot } from '@nestjs/cqrs';
import { Exclude } from 'class-transformer';

export interface IAggregateRoot {
  equals(entity: IAggregateRoot): boolean;
}

export abstract class AggregateRoot<PropsType> extends BaseAggregateRoot implements IAggregateRoot {
  @Exclude()
  protected props: PropsType;

  constructor(props: PropsType) {
    super();
    this.validate(props);
    this.props = props;
  }

  protected validate(props: PropsType) {
    if (props === undefined || props === null) {
      throw new Error(`${this.constructor.name} aggregate root not accept null props`);
    }
  }

  equals(aggregate: AggregateRoot<PropsType>): boolean {
    if (aggregate === null || aggregate === undefined) {
      return false;
    }

    if (this === aggregate) {
      return true;
    }

    return aggregate instanceof this.constructor;
  }
}
