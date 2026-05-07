/* eslint-disable @typescript-eslint/no-explicit-any */
export interface IEventSource {
  system: string;
  service?: string;
  module?: string;
}

export interface IActor {
  id?: string;
  name: string;
}

export interface IDomainEvent<Payload = any> {
  get id(): string;
  get refId(): string | undefined;
  get timestamp(): Date;
  get code(): string;
  get source(): IEventSource;
  get actor(): IActor;
  get payload(): Payload;
}

export interface IDomainEventMetadata {
  refId?: string;
  source?: IEventSource;
  actor?: IActor;
  timestamp?: Date;
}

export interface SerializedDomainEvent extends IDomainEvent<any> {}

export interface ICustomSerializerDomainEvent {
  serialize(): SerializedDomainEvent;
}

export abstract class DomainEvent<Payload = any> implements IDomainEvent<Payload> {
  public readonly id: string;
  public readonly refId: string | undefined;
  public readonly timestamp: Date;
  public readonly source: IEventSource;
  public readonly actor: IActor;
  public readonly payload!: Payload;

  constructor(init: Pick<DomainEvent, 'id' | 'refId'> & { timestamp?: Date; actor?: IActor; source: Partial<IEventSource> }) {
    this.id = init.id;
    this.refId = init.refId;
    this.timestamp = init.timestamp || new Date();
    this.actor = init.actor || { name: 'system' };

    this.source = {
      ...{
        system: 'template',
        service: 'blog-service',
      },
      ...init.source,
    };
  }

  public abstract get code(): string;
  public abstract key(): string;
}
