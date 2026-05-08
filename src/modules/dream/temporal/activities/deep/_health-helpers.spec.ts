/**
 * Unit tests for `_health-helpers.ts` (Story 13.10.5 / Q5).
 * Content moved from `src/modules/dream/health/run-health-checks.spec.ts`
 * + `auto-fix-health-issues.spec.ts`. Same coverage; new location.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { HealthReport } from '../../../agents/health-report.schema';
import { autoFixHealthIssues, runHealthChecks, MEMORY_OVERFLOW_THRESHOLD } from './_health-helpers';

describe('runHealthChecks', () => {
  let vault: string;

  beforeEach(async () => {
    vault = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-health-'));
  });

  afterEach(async () => {
    await fs.rm(vault, { recursive: true, force: true });
  });

  async function writeFile(rel: string, content: string): Promise<void> {
    const full = path.join(vault, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf-8');
  }

  it('should return zero issues for an empty vault', async () => {
    const report = await runHealthChecks(vault);
    expect(report.total_issues).toBe(0);
    expect(report.orphan_notes).toEqual([]);
    expect(report.memory_overflow).toBe(false);
  });

  it('should detect missing_frontmatter when a file is missing both --- fences', async () => {
    await writeFile('decisions/_index.md', '# Decisions\n- [Foo](foo.md)\n');
    await writeFile('decisions/foo.md', '# Foo\nNo frontmatter at all.\n');
    const report = await runHealthChecks(vault);
    expect(report.missing_frontmatter).toContain('decisions/foo.md');
    expect(report.total_issues).toBeGreaterThan(0);
  });

  it('should detect orphan_notes when a file is not in _index.md', async () => {
    await writeFile('decisions/_index.md', '# Decisions\n');
    await writeFile('decisions/orphan.md', '---\ntype: decision\n---\n# Orphan\n');
    const report = await runHealthChecks(vault);
    expect(report.orphan_notes).toContain('decisions/orphan.md');
  });

  it('should detect unresolved_contradictions when frontmatter has has_contradiction: true', async () => {
    await writeFile('decisions/_index.md', '# Decisions\n- foo\n');
    await writeFile('decisions/foo.md', '---\ntype: decision\nhas_contradiction: true\n---\n# Foo\n');
    const report = await runHealthChecks(vault);
    expect(report.unresolved_contradictions).toContain('decisions/foo.md');
  });

  it('should set memory_overflow when MEMORY.md has > 180 lines', async () => {
    const lines = new Array(MEMORY_OVERFLOW_THRESHOLD + 20).fill('- entry').join('\n');
    await writeFile('MEMORY.md', lines);
    const report = await runHealthChecks(vault);
    expect(report.memory_overflow).toBe(true);
    expect(report.total_issues).toBeGreaterThan(0);
  });

  it('should leave memory_overflow false when MEMORY.md has 180 lines or fewer', async () => {
    const lines = new Array(MEMORY_OVERFLOW_THRESHOLD).fill('- entry').join('\n');
    await writeFile('MEMORY.md', lines);
    const report = await runHealthChecks(vault);
    expect(report.memory_overflow).toBe(false);
  });

  it('should pass through knowledge_gaps without inspecting them', async () => {
    const report = await runHealthChecks(vault, ['MissingConcept', 'AnotherGap']);
    expect(report.knowledge_gaps).toEqual(['MissingConcept', 'AnotherGap']);
    expect(report.total_issues).toBe(2);
  });

  it('should detect missing_backlinks when a wikilink lacks a reverse entry', async () => {
    await writeFile('decisions/_index.md', '# Decisions\n- foo\n');
    await writeFile('decisions/foo.md', '---\ntype: decision\n---\n# Foo\n[[patterns/bar]]\n');
    await writeFile('patterns/_index.md', '# Patterns\n- bar\n');
    await writeFile('patterns/bar.md', '---\ntype: pattern\n---\n# Bar\nNo reverse link to foo.\n');
    const report = await runHealthChecks(vault);
    expect(report.missing_backlinks.length).toBeGreaterThan(0);
    expect(report.missing_backlinks[0]).toContain('decisions/foo.md');
    expect(report.missing_backlinks[0]).toContain('patterns/bar.md');
  });

  it('should detect broken_wikilinks when target file does not exist', async () => {
    await writeFile('decisions/_index.md', '# Decisions\n- foo\n');
    await writeFile('decisions/foo.md', '---\ntype: decision\n---\n# Foo\n[[patterns/missing-pattern]]\n');
    const report = await runHealthChecks(vault);
    expect(report.broken_wikilinks.length).toBeGreaterThan(0);
    expect(report.broken_wikilinks[0]).toContain('missing-pattern');
  });

  it('should skip references/ files for stale and contradiction checks', async () => {
    await writeFile('references/_index.md', '# References\n- foo\n');
    await writeFile('references/foo.md', '---\ntype: reference\nhas_contradiction: true\n---\n# Foo\n');
    const report = await runHealthChecks(vault);
    expect(report.unresolved_contradictions).not.toContain('references/foo.md');
  });

  it('should detect unclassified_lessons when older than 90 days with no outcome', async () => {
    const old = new Date();
    old.setDate(old.getDate() - 100);
    const oldIso = old.toISOString().slice(0, 10);
    await writeFile('lessons/_index.md', '# Lessons\n- foo\n');
    await writeFile('lessons/foo.md', `---\ntype: lesson\ncreated: ${oldIso}\n---\n# Foo\n`);
    const report = await runHealthChecks(vault);
    expect(report.unclassified_lessons).toContain('lessons/foo.md');
  });

  it('should NOT flag unclassified_lessons when frontmatter has outcome:', async () => {
    const old = new Date();
    old.setDate(old.getDate() - 100);
    const oldIso = old.toISOString().slice(0, 10);
    await writeFile('lessons/_index.md', '# Lessons\n- foo\n');
    await writeFile('lessons/foo.md', `---\ntype: lesson\ncreated: ${oldIso}\noutcome: success\n---\n# Foo\n`);
    const report = await runHealthChecks(vault);
    expect(report.unclassified_lessons).not.toContain('lessons/foo.md');
  });

  it('total_issues = sum of all 8 lists + (memory_overflow ? 1 : 0)', async () => {
    await writeFile('decisions/_index.md', '# Decisions\n- foo\n');
    await writeFile('decisions/foo.md', '# No frontmatter');
    await writeFile('decisions/bar.md', '---\ntype: decision\n---\n# Bar');
    const lines = new Array(MEMORY_OVERFLOW_THRESHOLD + 20).fill('- entry').join('\n');
    await writeFile('MEMORY.md', lines);
    const report = await runHealthChecks(vault, ['Gap1']);
    const expected =
      report.orphan_notes.length +
      report.stale_notes.length +
      report.missing_frontmatter.length +
      report.unresolved_contradictions.length +
      (report.memory_overflow ? 1 : 0) +
      report.knowledge_gaps.length +
      report.missing_backlinks.length +
      report.unclassified_lessons.length +
      report.broken_wikilinks.length;
    expect(report.total_issues).toBe(expected);
    expect(report.total_issues).toBeGreaterThan(0);
  });
});

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
      await writeFile('decisions/foo.md', '---\ntype: decision\n---\n# Foo\n[[patterns/bar]]\n');
      await writeFile('patterns/bar.md', '---\ntype: pattern\n---\n# Bar\n');
      const report = emptyReport();
      report.missing_backlinks = ['decisions/foo.md → patterns/bar.md (no reverse link)'];

      const counts = await autoFixHealthIssues(vault, report);

      expect(counts.fixed_backlinks).toBe(1);
      const targetText = await readFile('patterns/bar.md');
      expect(targetText).toContain('## Related');
      expect(targetText).toContain('[[decisions/foo]]');
    });

    it('should be idempotent — running twice produces byte-equal output', async () => {
      await writeFile('decisions/foo.md', '---\ntype: decision\n---\n# Foo\n[[patterns/bar]]\n');
      await writeFile('patterns/bar.md', '---\ntype: pattern\n---\n# Bar\n');
      const report = emptyReport();
      report.missing_backlinks = ['decisions/foo.md → patterns/bar.md (no reverse link)'];

      await autoFixHealthIssues(vault, report);
      const after1 = await readFile('patterns/bar.md');
      await autoFixHealthIssues(vault, report);
      const after2 = await readFile('patterns/bar.md');

      expect(after2).toBe(after1);
    });
  });

  describe('missing_frontmatter', () => {
    it('should prepend default frontmatter to a file lacking it', async () => {
      await writeFile('decisions/foo.md', '# Foo\nNo frontmatter.\n');
      const report = emptyReport();
      report.missing_frontmatter = ['decisions/foo.md'];

      const counts = await autoFixHealthIssues(vault, report, { todayIso: '2026-05-08' });

      expect(counts.fixed_frontmatter).toBe(1);
      const text = await readFile('decisions/foo.md');
      expect(text).toMatch(/^---\ntype: decision\n/);
      expect(text).toContain('created: 2026-05-08');
    });

    it('should be idempotent when file already has frontmatter', async () => {
      const original = '---\ntype: decision\n---\n# Foo\n';
      await writeFile('decisions/foo.md', original);
      const report = emptyReport();
      report.missing_frontmatter = ['decisions/foo.md'];

      await autoFixHealthIssues(vault, report);
      const after = await readFile('decisions/foo.md');

      expect(after).toBe(original);
    });
  });

  describe('orphan_notes', () => {
    it('should append an entry to existing _index.md when orphan is missing', async () => {
      await writeFile('decisions/_index.md', '# Decisions\n');
      await writeFile('decisions/orphan.md', '---\ntype: decision\n---\n# Orphan\n');
      const report = emptyReport();
      report.orphan_notes = ['decisions/orphan.md'];

      const counts = await autoFixHealthIssues(vault, report);

      expect(counts.fixed_orphans).toBe(1);
      const indexText = await readFile('decisions/_index.md');
      expect(indexText).toContain('](orphan.md)');
    });

    it('should bootstrap _index.md when missing entirely', async () => {
      await writeFile('patterns/bar.md', '---\ntype: pattern\n---\n# Bar\n');
      const report = emptyReport();
      report.orphan_notes = ['patterns/bar.md'];

      const counts = await autoFixHealthIssues(vault, report);

      expect(counts.fixed_orphans).toBeGreaterThan(0);
      const indexText = await readFile('patterns/_index.md');
      expect(indexText).toContain('Bar');
      expect(indexText).toContain('](bar.md)');
    });

    it('should be idempotent when orphan is already in _index.md', async () => {
      const original = '# Decisions\n- [Foo](foo.md)\n';
      await writeFile('decisions/_index.md', original);
      await writeFile('decisions/foo.md', '---\ntype: decision\n---\n# Foo\n');
      const report = emptyReport();
      report.orphan_notes = ['decisions/foo.md'];

      await autoFixHealthIssues(vault, report);
      const after = await readFile('decisions/_index.md');

      expect(after).toBe(original);
    });
  });

  it('should return zeros when report has no fixable issues', async () => {
    const counts = await autoFixHealthIssues(vault, emptyReport());
    expect(counts).toEqual({ fixed_backlinks: 0, fixed_frontmatter: 0, fixed_orphans: 0 });
  });
});
