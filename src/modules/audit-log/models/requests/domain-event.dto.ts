export interface DomainEventActorDto {
  id?: string;
  name: string;
}

export interface DomainEventSourceDto {
  system?: string;
  service?: string;
  module?: string;
}

export class DomainEventDto<TPayload = Record<string, unknown>> {
  id!: string;
  code!: string;
  refId?: string;
  timestamp!: Date;
  actor?: DomainEventActorDto;
  source?: DomainEventSourceDto;
  payload!: TPayload;
}
