/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DBConnections } from './utils/constaint';

@Injectable()
export class DataSourceLogger implements OnModuleInit, OnModuleDestroy {
  private internalTimer?: NodeJS.Timeout;

  constructor(
    @InjectDataSource(DBConnections.INTERNAL)
    private readonly internalDataSource: DataSource,
  ) {}

  onModuleInit() {
    if (process.env['DB_POOL_STATS'] !== 'true') return;

    const internalLogger = new Logger('PG-INTERNAL');
    this.internalTimer = setInterval(() => {
      const pool = (this.internalDataSource.driver as any).master;
      internalLogger.log(
        `DB Pool Statistics [Max: ${pool.options.max}, Current: ${pool._clients.length}, Busy: ${pool._clients.length - pool._idle.length}, Idle: ${
          pool._idle.length
        }, Tasks: ${pool._pendingQueue.length}]`,
      );
    }, 30000);
    this.internalTimer.unref();
  }

  onModuleDestroy() {
    if (this.internalTimer) {
      clearInterval(this.internalTimer);
    }
  }
}
