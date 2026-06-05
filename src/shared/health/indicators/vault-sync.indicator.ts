/**
 * VaultSyncService Terminus indicator (N-02 fix).
 *
 * Decision D pattern: always returns `status: 'up'` so `/health` stays HTTP
 * 200. The actual sync loop state (`running` / `stopped`) is encoded in the
 * `message` field. Health probe delegates to `VaultSyncService.isHealthy()`.
 */
import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { VaultSyncService } from 'src/modules/vault/vault-sync.service';

@Injectable()
export class VaultSyncHealthIndicator extends HealthIndicator {
  constructor(private readonly vaultSync: VaultSyncService) {
    super();
  }

  public async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const probe = this.vaultSync.isHealthy();
    return this.getStatus(key, true, { message: probe.message });
  }
}
