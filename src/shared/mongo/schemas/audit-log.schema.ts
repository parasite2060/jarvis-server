import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { AuditLog, AuditLogAction, AuditLogActor } from 'src/shared/domain/entities/audit-log.entity';

@Schema({ _id: false })
export class ActorDocument extends Document<AuditLogActor> {
  @Prop({ required: false, type: String })
  id?: string;

  @Prop({ required: true, type: String })
  name!: string;
}

export const ActorSchema = SchemaFactory.createForClass(ActorDocument);

@Schema({ collection: 'audit_logs', timestamps: { createdAt: true, updatedAt: false } })
export class AuditLogDocument extends Document<AuditLog> {
  @Prop({ required: true, type: String, index: true })
  eventCode!: string;

  @Prop({ required: true, type: String, index: true })
  entityType!: string;

  @Prop({ required: true, type: String, index: true })
  entityId!: string;

  @Prop({ required: true, type: String, enum: ['CREATE', 'UPDATE', 'DELETE'] })
  action!: AuditLogAction;

  @Prop({ required: true, type: MongooseSchema.Types.Mixed })
  payload!: Record<string, unknown>;

  @Prop({ required: true, type: ActorSchema })
  actor!: ActorDocument;

  @Prop({ required: true, type: Date, index: true })
  timestamp!: Date;

  // createdAt is automatically added by timestamps: true
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLogDocument);

AuditLogSchema.index({ entityId: 1, timestamp: -1 });
AuditLogSchema.index({ eventCode: 1, timestamp: -1 });
AuditLogSchema.index({ entityType: 1, timestamp: -1 });
