import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * Rejects strings containing CR, LF, or CRLF control characters.
 * Applied to sessionId to prevent HTTP header injection (SEC-02).
 *
 * Detection: raw `\r` or `\n` bytes — does NOT decode URL-encoded chars.
 * Stripped values are logged at debug level by the caller.
 */
export function NoControlChars(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'noControlChars',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return true; // other validators handle type
          return !/[\r\n]/.test(value);
        },
        defaultMessage(): string {
          return `${propertyName} contains control characters (CR or LF) which are not allowed`;
        },
      },
    });
  };
}
