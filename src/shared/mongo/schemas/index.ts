import { ModelDefinition } from '@nestjs/mongoose';
import { AuditLogDocument, AuditLogSchema } from './audit-log.schema';

// MongoDB schemas - add new schemas here
export const MongoSchemas: ModelDefinition[] = [{ name: AuditLogDocument.name, schema: AuditLogSchema }];
