import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { autoFixHealthIssues } from './auto-fix-health-issues';
import type { HealthReport } from '../agents/schemas/health-report.schema';

// Story 13.11 / AC #1 / AC #9 — auto-fix is idempotent (Stories 11.11/11.12/
// 11.13 lessons preserved). Tests verify that running each fixer twice on the
// same input is byte-equal (no duplicate writes).
describe('autoFixHealthIssues', () => {
  let vault: string;

  beforeEach(async () => {
    vault = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-autofix-'));
  });

  afterEach(async () => {
    await fs.rm(vault, { recursive: true, force: true });
  });

  async function writeFile(rel: string, content: string): Promise<void> {
    const full = path.join(vault, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf-8');
  }

  async function readFile(rel: string): Promise<string> {
    return fs.readFile(path.join(vault, rel), 'utf-8');
  }

  function emptyReport(): HealthReport {
    return {
      orphan_notes: [],
      stale_notes: [],
      missing_frontmatter: [],
      unresolved_contradictions: [],
      memory_overflow: false,
      knowledge_gaps: [],
      missing_backlinks: [],
      unclassified_lessons: [],
      broken_wikilinks: [],
      total_issues: 0,
    };
  }

  describe('missing_backlinks', () => {
    it('should write a reverse link in target ## Related when source has none', async () => {
      // Arrange — target has no Related section yet
      await writeFile('decisions/foo.md', '---\ntype: decision\n---\n# Foo\n[[patterns/bar]]\n');
      await writeFile('patterns/bar.md', '---\ntype: pattern\n---\n# Bar\n');
      const report = emptyReport();
      report.missing_backlinks = ['decisions/foo.md → patterns/bar.md (no reverse link)'];

      // Act
      const counts = await autoFixHealthIssues(vault, report);

      // Assert
      expect(counts.fixed_backlinks).toBe(1);
      const targetText = await readFile('patterns/bar.md');
      expect(targetText).toContain('## Related');
      expect(targetText).toContain('[[decisions/foo]]');
    });

    it('should be idempotent — running twice produces byte-equal output', async () => {
      // Arrange
      await writeFile('decisions/foo.md', '---\ntype: decision\n---\n# Foo\n[[patterns/bar]]\n');
      await writeFile('patterns/bar.md', '---\ntype: pattern\n---\n# Bar\n');
      const report = emptyReport();
      report.missing_backlinks = ['decisions/foo.md → patterns/bar.md (no reverse link)'];

      // Act
      await autoFixHealthIssues(vault, report);
      const after1 = await readFile('patterns/bar.md');
      await autoFixHealthIssues(vault, report);
      const after2 = await readFile('patterns/bar.md');

      // Assert
      expect(after2).toBe(after1);
    });
  });

  describe('missing_frontmatter', () => {
    it('should prepend default frontmatter to a file lacking it', async () => {
      // Arrange
      await writeFile('decisions/foo.md', '# Foo\nNo frontmatter.\n');
      const report = emptyReport();
      report.missing_frontmatter = ['decisions/foo.md'];

      // Act
      const counts = await autoFixHealthIssues(vault, report, { todayIso: '2026-05-08' });

      // Assert
      expect(counts.fixed_frontmatter).toBe(1);
      const text = await readFile('decisions/foo.md');
      expect(text).toMatch(/^---\ntype: decision\n/);
      expect(text).toContain('created: 2026-05-08');
    });

    it('should be idempotent when file already has frontmatter', async () => {
      // Arrange
      const original = '---\ntype: decision\n---\n# Foo\n';
      await writeFile('decisions/foo.md', original);
      const report = emptyReport();
      report.missing_frontmatter = ['decisions/foo.md'];

      // Act
      await autoFixHealthIssues(vault, report);
      const after = await readFile('decisions/foo.md');

      // Assert
      expect(after).toBe(original);
    });
  });

  describe('orphan_notes', () => {
    it('should append an entry to existing _index.md when orphan is missing', async () => {
      // Arrange — _index exists; orphan is not listed
      await writeFile('decisions/_index.md', '# Decisions\n');
      await writeFile('decisions/orphan.md', '---\ntype: decision\n---\n# Orphan\n');
      const report = emptyReport();
      report.orphan_notes = ['decisions/orphan.md'];

      // Act
      const counts = await autoFixHealthIssues(vault, report);

      // Assert
      expect(counts.fixed_orphans).toBe(1);
      const indexText = await readFile('decisions/_index.md');
      expect(indexText).toContain('](orphan.md)');
    });

    it('should bootstrap _index.md when missing entirely', async () => {
      // Arrange — no _index.md at all
      await writeFile('patterns/bar.md', '---\ntype: pattern\n---\n# Bar\n');
      const report = emptyReport();
      report.orphan_notes = ['patterns/bar.md'];

      // Act
      const counts = await autoFixHealthIssues(vault, report);

      // Assert
      expect(counts.fixed_orphans).toBeGreaterThan(0);
      const indexText = await readFile('patterns/_index.md');
      expect(indexText).toContain('Bar');
      expect(indexText).toContain('](bar.md)');
    });

    it('should be idempotent when orphan is already in _index.md', async () => {
      // Arrange
      const original = '# Decisions\n- [Foo](foo.md)\n';
      await writeFile('decisions/_index.md', original);
      await writeFile('decisions/foo.md', '---\ntype: decision\n---\n# Foo\n');
      const report = emptyReport();
      report.orphan_notes = ['decisions/foo.md'];

      // Act
      await autoFixHealthIssues(vault, report);
      const after = await readFile('decisions/_index.md');

      // Assert
      expect(after).toBe(original);
    });
  });

  it('should return zeros when report has no fixable issues', async () => {
    // Arrange / Act
    const counts = await autoFixHealthIssues(vault, emptyReport());

    // Assert
    expect(counts).toEqual({ fixed_backlinks: 0, fixed_frontmatter: 0, fixed_orphans: 0 });
  });
});
