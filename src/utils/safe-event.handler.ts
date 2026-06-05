import { Logger } from '@nestjs/common';
import { IEvent, IEventHandler } from '@nestjs/cqrs';

export abstract class SafeEventHandler<TEvent extends IEvent> implements IEventHandler<TEvent> {
  private readonly internalLogger: Logger;

  constructor() {
    this.internalLogger = new Logger(this.constructor.name);
  }

  async handle(event: TEvent): Promise<void | TEvent> {
    try {
      return await this.action(event);
    } catch (err) {
      this.internalLogger.error({
        message: 'Event execute failed',
        error: err,
      });

      return undefined;
    }
  }

  protected abstract action(event: TEvent): Promise<void | TEvent>;
}
