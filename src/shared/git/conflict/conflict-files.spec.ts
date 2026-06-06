import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import simpleGit, { SimpleGit } from 'simple-git';
import { readConflictVersions, isProtected, matchesAllowGlobs } from './conflict-files';

describe('readConflictVersions', () => {
  let dir: string;
  let git: SimpleGit;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-conflict-files-'));
    git = simpleGit({ baseDir: dir });
    // Pin the initial branch to `main` — CI runners default `git init` to
    // `master`, so `checkout('main')` below would fail without this.
    await git.init(['--initial-branch=main']);
    await git.addConfig('user.email', 'test@test.local');
    await git.addConfig('user.name', 'Test');

    // base commit on main
    await fs.mkdir(path.join(dir, 'dailys'), { recursive: true });
    await fs.writeFile(path.join(dir, 'dailys', 'x.md'), 'line1\nbase\nline3\n');
    await git.add('.');
    await git.commit('base');

    // branch 'dream' modifies line2
    await git.checkoutLocalBranch('dream');
    await fs.writeFile(path.join(dir, 'dailys', 'x.md'), 'line1\ndream-change\nline3\n');
    await git.add('.');
    await git.commit('dream side');

    // main modifies line2
    await git.checkout('main');
    await fs.writeFile(path.join(dir, 'dailys', 'x.md'), 'line1\nmain-change\nline3\n');
    await git.add('.');
    await git.commit('main side');

    // rebase dream onto main -> conflict
    await git.checkout('dream');
    try {
      await git.rebase(['main']);
    } catch {
      // expected conflict — rebase leaves repo in conflicted state
    }
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns base/dream/main for a conflicted file', async () => {
    const v = await readConflictVersions(git, 'dailys/x.md');
    expect(v.base).toContain('base');
    expect(v.dream).toContain('dream-change');
    expect(v.main).toContain('main-change');
  });
});

describe('isProtected', () => {
  it('matches a protected file by exact path', () => {
    expect(isProtected('MEMORY.md', ['MEMORY.md', 'SOUL.md'])).toBe(true);
    expect(isProtected('dailys/2026-06-06.md', ['MEMORY.md'])).toBe(false);
  });
});

describe('matchesAllowGlobs', () => {
  it('matches dailys/* and vault folder globs', () => {
    expect(matchesAllowGlobs('dailys/2026-06-06.md', ['dailys/*'])).toBe(true);
    expect(matchesAllowGlobs('decisions/foo.md', ['dailys/*', 'decisions/*'])).toBe(true);
    expect(matchesAllowGlobs('MEMORY.md', ['dailys/*'])).toBe(false);
    expect(matchesAllowGlobs('dailys/sub/deep.md', ['dailys/*'])).toBe(true);
  });

  it('does not false-match a sibling directory sharing the prefix', () => {
    expect(matchesAllowGlobs('dailysX/y.md', ['dailys/*'])).toBe(false);
  });
});
