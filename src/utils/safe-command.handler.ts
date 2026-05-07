import { Logger } from '@nestjs/common';
import { ICommand } from '@nestjs/cqrs';

export abstract class SafeCommandHandler<TCommand extends ICommand, TResponse> {
  private internalLogger = new Logger(this.constructor.name);

  async execute(command: TCommand): Promise<TResponse> {
    try {
      return await this.action(command);
    } catch (err) {
      this.internalLogger.error({
        message: 'Command execute failed',
        error: err,
      });

      return null as unknown as TResponse;
    }
  }

  protected abstract action(command: TCommand): Promise<TResponse>;
}
