/**
 * Marks a route as publicly accessible (bypasses ApiKeyGuard).
 * Use on controller methods that need no auth, e.g. /health.
 */
import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from 'src/shared/auth/constants/public.metadata';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
