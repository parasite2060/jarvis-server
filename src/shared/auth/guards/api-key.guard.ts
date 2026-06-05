/**
 * ApiKeyGuard — Story 13.19.
 *
 * Validates the API key against AppConfigService.apiKey. Accepts the key via the
 * `api_key` or `x-api-key` header, or as an `Authorization: Bearer <key>` header
 * (the jarvis-claude-plugin hooks + MCP client send the latter).
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
    const providedKey = this.extractKey(request.headers);

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

  /**
   * Resolve the API key from (in priority order) the `api_key` header, the
   * `x-api-key` header, or an `Authorization: Bearer <key>` header.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractKey(headers: Record<string, any>): string {
    const direct = headers['api_key'] ?? headers['x-api-key'];
    if (direct) return Array.isArray(direct) ? direct[0] : direct;

    const authRaw = headers['authorization'];
    const auth = Array.isArray(authRaw) ? authRaw[0] : authRaw;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      return auth.slice('Bearer '.length).trim();
    }
    return '';
  }
}
