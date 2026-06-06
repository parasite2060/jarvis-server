import { buildConflictAuditSection, buildConflictAuditFile } from './conflict-audit';
import type { ConflictResolutionAudit } from 'src/shared/git/conflict/resolve-conflict';

const makeAudit = (path: string, reasoning: string): ConflictResolutionAudit => ({
  path,
  base: `base of ${path}`,
  dream: `dream of ${path}`,
  main: `main of ${path}`,
  resolvedContent: `resolved ${path}`,
  reasoning,
});

describe('buildConflictAuditSection', () => {
  it('returns empty string when audits array is empty', () => {
    expect(buildConflictAuditSection([])).toBe('');
  });

  it('includes the warning emoji header for non-empty audits', () => {
    const section = buildConflictAuditSection([makeAudit('dailys/2026-06-05.md', 'merged reasonably')]);
    expect(section).toContain('⚠️');
  });

  it('lists the conflicted file paths in the section', () => {
    const section = buildConflictAuditSection([makeAudit('dailys/2026-06-05.md', 'reasoning A')]);
    expect(section).toContain('`dailys/2026-06-05.md`');
  });

  it('includes the reasoning for each file', () => {
    const section = buildConflictAuditSection([makeAudit('dailys/2026-06-05.md', 'took the dream version')]);
    expect(section).toContain('took the dream version');
  });

  it('handles multiple audits — lists all files and reasons', () => {
    const audits = [makeAudit('dailys/a.md', 'reason A'), makeAudit('patterns/b.md', 'reason B')];
    const section = buildConflictAuditSection(audits);
    expect(section).toContain('`dailys/a.md`');
    expect(section).toContain('`patterns/b.md`');
    expect(section).toContain('reason A');
    expect(section).toContain('reason B');
  });
});

describe('buildConflictAuditFile', () => {
  const audit = makeAudit('dailys/2026-06-05.md', 'merged dream into main');

  it('uses conflict_resolutions/<sanitized-branch>.md as the path', () => {
    const { path } = buildConflictAuditFile('dream/light-abc123', [audit]);
    expect(path).toBe('conflict_resolutions/dream-light-abc123.md');
  });

  it('sanitizes branch name by replacing special chars with hyphens', () => {
    const { path } = buildConflictAuditFile('feature/my feature!', [audit]);
    expect(path).toBe('conflict_resolutions/feature-my-feature-.md');
  });

  it('content begins with the branch name heading', () => {
    const { content } = buildConflictAuditFile('dream/light-abc', [audit]);
    expect(content).toContain('# Conflict resolution audit — dream/light-abc');
  });

  it('content contains BASE section with the base version', () => {
    const { content } = buildConflictAuditFile('dream/light-abc', [audit]);
    expect(content).toContain('### BASE');
    expect(content).toContain('base of dailys/2026-06-05.md');
  });

  it('content contains DREAM section with the dream version', () => {
    const { content } = buildConflictAuditFile('dream/light-abc', [audit]);
    expect(content).toContain('### DREAM (dream changes)');
    expect(content).toContain('dream of dailys/2026-06-05.md');
  });

  it('content contains MAIN section with the main version', () => {
    const { content } = buildConflictAuditFile('dream/light-abc', [audit]);
    expect(content).toContain('### MAIN (your edits)');
    expect(content).toContain('main of dailys/2026-06-05.md');
  });

  it('content contains RESOLVED section with the resolved content', () => {
    const { content } = buildConflictAuditFile('dream/light-abc', [audit]);
    expect(content).toContain('### RESOLVED');
    expect(content).toContain('resolved dailys/2026-06-05.md');
  });

  it('content contains the reasoning', () => {
    const { content } = buildConflictAuditFile('dream/light-abc', [audit]);
    expect(content).toContain('merged dream into main');
  });

  it('wraps the version sections in tilde fences (not backtick fences)', () => {
    const { content } = buildConflictAuditFile('dream/light-abc', [audit]);
    expect(content).toContain('~~~');
    expect(content).not.toContain('```');
  });

  it('produces a well-formed audit file when a version contains a backtick code fence', () => {
    const embeddedFence: ConflictResolutionAudit = {
      path: 'dailys/2026-06-05.md',
      base: 'before',
      dream: '```ts\nconst x = 1;\n```',
      main: 'after',
      resolvedContent: '```ts\nconst x = 2;\n```',
      reasoning: 'kept the newer version',
    };
    const { content } = buildConflictAuditFile('dream/light-abc', [embeddedFence]);

    // The embedded backtick fence is preserved verbatim inside the tilde fence...
    expect(content).toContain('```ts\nconst x = 1;\n```');
    // ...and the outer tilde fences are intact so the markdown is not corrupted.
    const tildeFenceCount = (content.match(/^~~~$/gm) ?? []).length;
    expect(tildeFenceCount).toBe(8);
  });
});
