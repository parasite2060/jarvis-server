import { randomBytes } from 'crypto';

export function randomId(byteCount = 8): string {
  return randomBytes(byteCount).toString('hex');
}
