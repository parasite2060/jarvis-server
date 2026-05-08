import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { runHealthChecks, MEMORY_OVERFLOW_THRESHOLD } from './run-health-checks';

// Story 13.11 / AC #1, #11. Fixture-driven against ephemeral tmp dirs so we
// can exercise every issue type with deterministic FS state.
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
    // Arrange / Act
    const report = await runHealthChecks(vault);

    // Assert
    expect(report.total_issues).toBe(0);
    expect(report.orphan_notes).toEqual([]);
    expect(report.memory_overflow).toBe(false);
  });

  it('should detect missing_frontmatter when a file is missing both --- fences', async () => {
    // Arrange
    await writeFile('decisions/_index.md', '# Decisions\n- [Foo](foo.md)\n');
    await writeFile('decisions/foo.md', '# Foo\nNo frontmatter at all.\n');

    // Act
    const report = await runHealthChecks(vault);

    // Assert
    expect(report.missing_frontmatter).toContain('decisions/foo.md');
    expect(report.total_issues).toBeGreaterThan(0);
  });

  it('should detect orphan_notes when a file is not in _index.md', async () => {
    // Arrange — _index.md exists but does NOT mention orphan.md
    await writeFile('decisions/_index.md', '# Decisions\n');
    await writeFile('decisions/orphan.md', '---\ntype: decision\n---\n# Orphan\n');

    // Act
    const report = await runHealthChecks(vault);

    // Assert
    expect(report.orphan_notes).toContain('decisions/orphan.md');
  });

  it('should detect unresolved_contradictions when frontmatter has has_contradiction: true', async () => {
    // Arrange
    await writeFile('decisions/_index.md', '# Decisions\n- foo\n');
    await writeFile('decisions/foo.md', '---\ntype: decision\nhas_contradiction: true\n---\n# Foo\n');

    // Act
    const report = await runHealthChecks(vault);

    // Assert
    expect(report.unresolved_contradictions).toContain('decisions/foo.md');
  });

  it('should set memory_overflow when MEMORY.md has > 180 lines', async () => {
    // Arrange — write 200 lines
    const lines = new Array(MEMORY_OVERFLOW_THRESHOLD + 20).fill('- entry').join('\n');
    await writeFile('MEMORY.md', lines);

    // Act
    const report = await runHealthChecks(vault);

    // Assert
    expect(report.memory_overflow).toBe(true);
    expect(report.total_issues).toBeGreaterThan(0);
  });

  it('should leave memory_overflow false when MEMORY.md has 180 lines or fewer', async () => {
    // Arrange — exactly 180 lines (NOT > threshold)
    const lines = new Array(MEMORY_OVERFLOW_THRESHOLD).fill('- entry').join('\n');
    await writeFile('MEMORY.md', lines);

    // Act
    const report = await runHealthChecks(vault);

    // Assert
    expect(report.memory_overflow).toBe(false);
  });

  it('should pass through knowledge_gaps without inspecting them', async () => {
    // Arrange / Act
    const report = await runHealthChecks(vault, ['MissingConcept', 'AnotherGap']);

    // Assert
    expect(report.knowledge_gaps).toEqual(['MissingConcept', 'AnotherGap']);
    expect(report.total_issues).toBe(2);
  });

  it('should detect missing_backlinks when a wikilink lacks a reverse entry', async () => {
    // Arrange — decision links to pattern; pattern has no reverse link.
    await writeFile('decisions/_index.md', '# Decisions\n- foo\n');
    await writeFile('decisions/foo.md', '---\ntype: decision\n---\n# Foo\n[[patterns/bar]]\n');
    await writeFile('patterns/_index.md', '# Patterns\n- bar\n');
    await writeFile('patterns/bar.md', '---\ntype: pattern\n---\n# Bar\nNo reverse link to foo.\n');

    // Act
    const report = await runHealthChecks(vault);

    // Assert
    expect(report.missing_backlinks.length).toBeGreaterThan(0);
    expect(report.missing_backlinks[0]).toContain('decisions/foo.md');
    expect(report.missing_backlinks[0]).toContain('patterns/bar.md');
  });

  it('should detect broken_wikilinks when target file does not exist', async () => {
    // Arrange — decision links to a non-existent target
    await writeFile('decisions/_index.md', '# Decisions\n- foo\n');
    await writeFile('decisions/foo.md', '---\ntype: decision\n---\n# Foo\n[[patterns/missing-pattern]]\n');

    // Act
    const report = await runHealthChecks(vault);

    // Assert
    expect(report.broken_wikilinks.length).toBeGreaterThan(0);
    expect(report.broken_wikilinks[0]).toContain('missing-pattern');
  });

  it('should skip references/ files for stale and contradiction checks', async () => {
    // Arrange — references/ file with has_contradiction: true; should NOT show up
    await writeFile('references/_index.md', '# References\n- foo\n');
    await writeFile('references/foo.md', '---\ntype: reference\nhas_contradiction: true\n---\n# Foo\n');

    // Act
    const report = await runHealthChecks(vault);

    // Assert
    expect(report.unresolved_contradictions).not.toContain('references/foo.md');
  });

  it('should detect unclassified_lessons when older than 90 days with no outcome', async () => {
    // Arrange — created 100 days ago, no outcome
    const old = new Date();
    old.setDate(old.getDate() - 100);
    const oldIso = old.toISOString().slice(0, 10);
    await writeFile('lessons/_index.md', '# Lessons\n- foo\n');
    await writeFile('lessons/foo.md', `---\ntype: lesson\ncreated: ${oldIso}\n---\n# Foo\n`);

    // Act
    const report = await runHealthChecks(vault);

    // Assert
    expect(report.unclassified_lessons).toContain('lessons/foo.md');
  });

  it('should NOT flag unclassified_lessons when frontmatter has outcome:', async () => {
    // Arrange — old but with outcome
    const old = new Date();
    old.setDate(old.getDate() - 100);
    const oldIso = old.toISOString().slice(0, 10);
    await writeFile('lessons/_index.md', '# Lessons\n- foo\n');
    await writeFile('lessons/foo.md', `---\ntype: lesson\ncreated: ${oldIso}\noutcome: success\n---\n# Foo\n`);

    // Act
    const report = await runHealthChecks(vault);

    // Assert
    expect(report.unclassified_lessons).not.toContain('lessons/foo.md');
  });

  it('total_issues = sum of all 8 lists + (memory_overflow ? 1 : 0)', async () => {
    // Arrange — combine multiple issue types
    await writeFile('decisions/_index.md', '# Decisions\n- foo\n'); // foo IS in index
    await writeFile('decisions/foo.md', '# No frontmatter');
    await writeFile('decisions/bar.md', '---\ntype: decision\n---\n# Bar'); // orphan (not in _index)
    const lines = new Array(MEMORY_OVERFLOW_THRESHOLD + 20).fill('- entry').join('\n');
    await writeFile('MEMORY.md', lines); // memory_overflow

    // Act
    const report = await runHealthChecks(vault, ['Gap1']);

    // Assert
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
