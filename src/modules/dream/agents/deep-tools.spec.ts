import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { queryMemuMemoriesFactory, readDailyLogPreloadedFactory, readDailyLogLiveFactory, readVaultIndexFactory } from './deep-tools';

describe('deep-tools', () => {
  describe('queryMemuMemoriesFactory', () => {
    it('returns the JSON-stringified pre-loaded list (no live MemU call)', async () => {
      const memories = [{ content: 'first', kind: 'fact' }];
      const tool = queryMemuMemoriesFactory(memories);

      const out = await tool.invoke({});

      expect(out).toBe(JSON.stringify(memories));
    });
  });

  describe('readDailyLogPreloadedFactory', () => {
    it('returns the dict entry for the requested date_str', async () => {
      const dailyLogs = { '2026-05-07': '## Session\nbody' };
      const tool = readDailyLogPreloadedFactory(dailyLogs);

      const out = await tool.invoke({ date_str: '2026-05-07' });

      expect(out).toBe('## Session\nbody');
    });

    it('returns sentinel for unknown date_str', async () => {
      const tool = readDailyLogPreloadedFactory({});
      const out = await tool.invoke({ date_str: '1999-01-01' });
      expect(out).toBe('(no daily log)');
    });
  });

  describe('readDailyLogLiveFactory', () => {
    let vault: string;
    beforeEach(async () => {
      vault = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-deep-tools-'));
    });
    afterEach(async () => {
      await fs.rm(vault, { recursive: true, force: true });
    });

    it('reads dailys/{date}.md from disk', async () => {
      const dailysDir = path.join(vault, 'dailys');
      await fs.mkdir(dailysDir, { recursive: true });
      await fs.writeFile(path.join(dailysDir, '2026-05-07.md'), 'live body', 'utf-8');
      const tool = readDailyLogLiveFactory(vault);

      const out = await tool.invoke({ date_str: '2026-05-07' });

      expect(out).toBe('live body');
    });

    it('returns sentinel when daily log is missing', async () => {
      const tool = readDailyLogLiveFactory(vault);
      const out = await tool.invoke({ date_str: '2026-01-01' });
      expect(out).toBe('(no daily log)');
    });

    it('rejects path traversal in date_str — daily folder relative root prevents escape', async () => {
      const tool = readDailyLogLiveFactory(vault);
      // date_str like '../etc' resolves outside vault root — safeResolveVaultPath returns null.
      const out = await tool.invoke({ date_str: '../etc/passwd' });
      expect(out).toMatch(/(outside the vault root|no daily log)/);
    });
  });

  describe('readVaultIndexFactory', () => {
    let vault: string;
    beforeEach(async () => {
      vault = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-deep-tools-idx-'));
    });
    afterEach(async () => {
      await fs.rm(vault, { recursive: true, force: true });
    });

    it('reads {folder}/_index.md from disk', async () => {
      const folderDir = path.join(vault, 'decisions');
      await fs.mkdir(folderDir, { recursive: true });
      await fs.writeFile(path.join(folderDir, '_index.md'), '# Decisions index', 'utf-8');
      const tool = readVaultIndexFactory(vault);

      const out = await tool.invoke({ folder: 'decisions' });

      expect(out).toBe('# Decisions index');
    });

    it('returns sentinel when _index.md missing', async () => {
      const tool = readVaultIndexFactory(vault);
      const out = await tool.invoke({ folder: 'patterns' });
      expect(out).toBe('(no index)');
    });
  });
});
