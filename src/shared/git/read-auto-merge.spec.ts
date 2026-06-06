/**
 * Unit spec for readAutoMergeFromVault — drives whether dream PRs auto-merge.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  readAutoMergeFromVault,
  DEFAULT_AUTO_MERGE,
  readConflictConfig,
  DEFAULT_AI_CONFLICT_RESOLUTION,
  DEFAULT_CONFLICT_ALLOW_GLOBS,
  DEFAULT_PROTECTED_FILES,
  DEFAULT_AUTO_MERGE_RESOLVED,
} from './read-auto-merge';

describe('readAutoMergeFromVault', () => {
  let vaultDir: string;

  beforeEach(async () => {
    vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-vault-'));
  });

  afterEach(async () => {
    await fs.rm(vaultDir, { recursive: true, force: true });
  });

  it('returns true when config.yml has auto_merge: true', async () => {
    await fs.writeFile(path.join(vaultDir, 'config.yml'), 'auto_merge: true\n');
    expect(await readAutoMergeFromVault(vaultDir)).toBe(true);
  });

  it('returns false when config.yml has auto_merge: false', async () => {
    await fs.writeFile(path.join(vaultDir, 'config.yml'), 'auto_merge: false\n');
    expect(await readAutoMergeFromVault(vaultDir)).toBe(false);
  });

  it('falls back to the default when config.yml is missing', async () => {
    expect(await readAutoMergeFromVault(vaultDir)).toBe(DEFAULT_AUTO_MERGE);
  });

  it('falls back to the default when auto_merge is absent or non-boolean', async () => {
    await fs.writeFile(path.join(vaultDir, 'config.yml'), 'deep_dream_cron: "0 20 * * *"\n');
    expect(await readAutoMergeFromVault(vaultDir)).toBe(DEFAULT_AUTO_MERGE);
  });

  it('falls back to the default on malformed YAML', async () => {
    await fs.writeFile(path.join(vaultDir, 'config.yml'), ':::not yaml:::\n  - [');
    expect(await readAutoMergeFromVault(vaultDir)).toBe(DEFAULT_AUTO_MERGE);
  });
});

describe('readConflictConfig', () => {
  let vaultDir: string;

  beforeEach(async () => {
    vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-conflict-'));
  });

  afterEach(async () => {
    await fs.rm(vaultDir, { recursive: true, force: true });
  });

  it('returns all defaults when config.yml is missing', async () => {
    const result = await readConflictConfig(vaultDir);
    expect(result).toEqual({
      aiConflictResolution: DEFAULT_AI_CONFLICT_RESOLUTION,
      allowGlobs: DEFAULT_CONFLICT_ALLOW_GLOBS,
      protectedFiles: DEFAULT_PROTECTED_FILES,
      autoMergeResolved: DEFAULT_AUTO_MERGE_RESOLVED,
    });
  });

  it('returns aiConflictResolution: true when ai_conflict_resolution: true', async () => {
    await fs.writeFile(path.join(vaultDir, 'config.yml'), 'ai_conflict_resolution: true\n');
    const result = await readConflictConfig(vaultDir);
    expect(result.aiConflictResolution).toBe(true);
  });

  it('uses allowGlobs override from ai_conflict_resolution_files', async () => {
    await fs.writeFile(path.join(vaultDir, 'config.yml'), 'ai_conflict_resolution_files:\n  - dailys/*\n');
    const result = await readConflictConfig(vaultDir);
    expect(result.allowGlobs).toEqual(['dailys/*']);
  });

  it('uses protectedFiles override from ai_conflict_resolution_protected', async () => {
    await fs.writeFile(path.join(vaultDir, 'config.yml'), 'ai_conflict_resolution_protected:\n  - MEMORY.md\n');
    const result = await readConflictConfig(vaultDir);
    expect(result.protectedFiles).toEqual(['MEMORY.md']);
  });

  it('uses autoMergeResolved: false from ai_conflict_resolution_auto_merge: false', async () => {
    await fs.writeFile(path.join(vaultDir, 'config.yml'), 'ai_conflict_resolution_auto_merge: false\n');
    const result = await readConflictConfig(vaultDir);
    expect(result.autoMergeResolved).toBe(false);
  });

  it('falls back to defaults on malformed YAML', async () => {
    await fs.writeFile(path.join(vaultDir, 'config.yml'), ':::not yaml:::\n  - [');
    const result = await readConflictConfig(vaultDir);
    expect(result).toEqual({
      aiConflictResolution: DEFAULT_AI_CONFLICT_RESOLUTION,
      allowGlobs: DEFAULT_CONFLICT_ALLOW_GLOBS,
      protectedFiles: DEFAULT_PROTECTED_FILES,
      autoMergeResolved: DEFAULT_AUTO_MERGE_RESOLVED,
    });
  });

  it('falls back to default allowGlobs when ai_conflict_resolution_files is not an array of strings', async () => {
    await fs.writeFile(path.join(vaultDir, 'config.yml'), 'ai_conflict_resolution_files: not-an-array\n');
    const result = await readConflictConfig(vaultDir);
    expect(result.allowGlobs).toEqual(DEFAULT_CONFLICT_ALLOW_GLOBS);
  });

  it('falls back to default protectedFiles when ai_conflict_resolution_protected is not an array of strings', async () => {
    await fs.writeFile(path.join(vaultDir, 'config.yml'), 'ai_conflict_resolution_protected: 42\n');
    const result = await readConflictConfig(vaultDir);
    expect(result.protectedFiles).toEqual(DEFAULT_PROTECTED_FILES);
  });
});
