/**
 * `IFileManifestRepository` impl — Story 13.6 / Task 6 (closes Story 13.2's
 * deferred-work).
 *
 * Mirrors Python `app/services/file_manifest.py :: sync_file_manifest_to_db()`
 * for the diff algorithm. Soft-fail inside the method per Q6 — the manifest
 * endpoint dispatches via `void this.repo.syncFromManifest(files)` and never
 * sees an error from this code path.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { FileManifestEntry } from 'src/shared/domain/entities/file-manifest-entry.entity';
import { IFileManifestRepository, VaultFileInfo } from 'src/shared/domain/repositories/file-manifest.repository.interface';
import { FileManifestSchema } from '../schema/file-manifest.schema';
import { DBConnections } from '../utils/constaint';

@Injectable()
export class FileManifestRepositoryImpl implements IFileManifestRepository {
  private readonly logger = new Logger(FileManifestRepositoryImpl.name);

  constructor(
    @InjectRepository(FileManifestSchema, DBConnections.INTERNAL)
    private readonly repository: Repository<FileManifestEntry>,
  ) {}

  async upsertEntry(entry: Partial<FileManifestEntry>): Promise<FileManifestEntry> {
    if (!entry.filePath) {
      throw new Error('upsertEntry requires entry.filePath');
    }
    const existing = await this.repository.findOne({ where: { filePath: entry.filePath } });
    if (existing) {
      if (entry.contentHash !== undefined) existing.contentHash = entry.contentHash;
      if (entry.fileSize !== undefined) existing.fileSize = entry.fileSize;
      return await this.repository.save(existing);
    }
    return await this.repository.save(this.repository.create(entry));
  }

  async getAll(): Promise<FileManifestEntry[]> {
    return await this.repository.find();
  }

  async getByPath(path: string): Promise<FileManifestEntry | null> {
    return await this.repository.findOne({ where: { filePath: path } });
  }

  async deleteByPath(path: string): Promise<void> {
    await this.repository.delete({ filePath: path });
  }

  async syncFromManifest(files: VaultFileInfo[]): Promise<void> {
    try {
      const existing = await this.repository.find();
      const existingByPath = new Map<string, FileManifestEntry>();
      for (const row of existing) existingByPath.set(row.filePath, row);

      const scannedPaths = new Set<string>();
      let inserted = 0;
      let updated = 0;
      for (const file of files) {
        scannedPaths.add(file.relativePath);
        const row = existingByPath.get(file.relativePath);
        if (row === undefined) {
          await this.repository.save(
            this.repository.create({
              filePath: file.relativePath,
              contentHash: file.contentHash,
              fileSize: file.fileSize,
            }),
          );
          inserted++;
          continue;
        }
        if (row.contentHash !== file.contentHash || row.fileSize !== file.fileSize) {
          row.contentHash = file.contentHash;
          row.fileSize = file.fileSize;
          await this.repository.save(row);
          updated++;
        }
      }

      const removed: string[] = [];
      for (const filePath of existingByPath.keys()) {
        if (!scannedPaths.has(filePath)) removed.push(filePath);
      }
      let deleted = 0;
      if (removed.length > 0) {
        const result = await this.repository.delete({ filePath: In(removed) });
        deleted = result.affected ?? removed.length;
      }

      this.logger.log({
        message: 'vault manifest db sync completed',
        event: 'vault.manifestDbSync.completed',
        scanned: files.length,
        inserted,
        updated,
        deleted,
      });
    } catch (err) {
      this.logger.error({
        message: 'vault manifest db sync failed',
        event: 'vault.manifestDbSync.failed',
        error: sanitiseError(err),
      });
    }
  }
}

function sanitiseError(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 200);
  return 'unknown';
}
