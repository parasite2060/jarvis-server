/**
 * ApiKeyGuard — Story 13.19.
 *
 * Validates the `API_KEY` request header against AppConfigService.apiKey.
 * Registered globally via APP_GUARD; /health is marked @Public() and bypasses
 * this guard via NestJS IS_PUBLIC_KEY metadata.
 */
import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppConfigService } from 'src/shared/config/config.service';
import { IS_PUBLIC_KEY } from 'src/shared/auth/constants/public.metadata';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const request = context.switchToHttp().getRequest<any>();
    const rawHeader = request.headers['api_key'] ?? request.headers['x-api-key'] ?? '';
    const providedKey = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    if (!providedKey) {
      this.logger.log({
        event: 'auth.api_key.missing',
        path: request.url,
      });
      throw new UnauthorizedException('API key is required');
    }

    if (providedKey !== this.config.apiKey) {
      this.logger.log({
        event: 'auth.api_key.rejected',
        path: request.url,
      });
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }
}
