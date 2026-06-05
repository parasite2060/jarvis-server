/**
 * TriggerLightDreamHandler — sync CommandBus handler (Story 13.10.5 / Q2).
 *
 * Per Q2 RESOLVED 2026-05-08 by TanNT: the handler delegates to the dream
 * module's `TriggerLightDreamUseCase`, which signals the Temporal coordinator.
 * `CommandBus.execute` returns void; the trigger is fire-and-forget at the
 * conversation-module boundary (Temporal's signal queue makes it durable
 * inside the dream module).
 *
 * Behavior preservation: the handler's net effect is identical to the
 * pre-13.10.5 conversation→dream direct-injection path (single
 * `signalCoordinator('light', ...)` call). Failures are logged inside the
 * use case; the handler does NOT swallow errors, but light-dream signals
 * are non-fatal at the HTTP boundary by design.
 */
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { TriggerLightDreamCommand } from '../trigger-light-dream.command';
import { TriggerLightDreamUseCase } from '../../usecases/trigger-light-dream.usecase';

@CommandHandler(TriggerLightDreamCommand)
export class TriggerLightDreamHandler implements ICommandHandler<TriggerLightDreamCommand, void> {
  private readonly logger = new Logger(TriggerLightDreamHandler.name);

  constructor(private readonly useCase: TriggerLightDreamUseCase) {}

  async execute(command: TriggerLightDreamCommand): Promise<void> {
    this.logger.log({
      message: 'dream.triggerLightHandler.invoked',
      event: 'dream.triggerLightHandler.invoked',
      sessionId: command.payload.sessionId,
      transcriptId: command.payload.transcriptId,
    });
    await this.useCase.execute({
      sessionId: command.payload.sessionId,
      transcriptId: command.payload.transcriptId,
    });
  }
}
