/**
 * CronExpressionValidator — class-validator constraint that delegates to
 * `cron-parser`'s `parseExpression(str)` (Q4 RESOLVED 2026-05-09 by 13.10.5
 * scaffold = Option B). Catches invalid crons that Python's 5-field regex
 * accepts but Temporal would reject.
 */
import { ValidationOptions, registerDecorator } from 'class-validator';
import { CronExpressionParser } from 'cron-parser';

export function IsCronExpression(validationOptions?: ValidationOptions): PropertyDecorator {
  return function (object: object, propertyName: string | symbol) {
    registerDecorator({
      name: 'isCronExpression',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;
          try {
            CronExpressionParser.parse(value);
            return true;
          } catch {
            return false;
          }
        },
        defaultMessage(): string {
          return 'Invalid cron expression: must be a valid 5-field cron string';
        },
      },
    });
  };
}
