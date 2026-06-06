/**
 * Unit spec for readAutoMergeFromVault — drives whether dream PRs auto-merge.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { readAutoMergeFromVault, DEFAULT_AUTO_MERGE } from './read-auto-merge';

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
