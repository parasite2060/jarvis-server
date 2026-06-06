import type { ConflictResolutionAudit } from 'src/shared/git/conflict/resolve-conflict';

export function buildConflictAuditSection(audits: ConflictResolutionAudit[]): string {
  if (audits.length === 0) return '';
  const files = audits.map((a) => `\`${a.path}\``).join(', ');
  const details = audits.map((a) => `- **${a.path}** — ${a.reasoning}`).join('\n');
  return [
    '',
    '### ⚠️ AI-resolved merge conflict',
    `The dream rebase hit a conflict in ${files}; it was auto-resolved by AI. Review carefully.`,
    '',
    details,
  ].join('\n');
}

export function buildConflictAuditFile(branch: string, audits: ConflictResolutionAudit[]): { path: string; content: string } {
  const safeBranch = branch.replace(/[^a-zA-Z0-9._-]/g, '-');
  const content = audits
    .map((a) =>
      [
        `## ${a.path}`,
        '',
        `**Reasoning:** ${a.reasoning}`,
        '',
        '### BASE',
        '~~~',
        a.base,
        '~~~',
        '### DREAM (dream changes)',
        '~~~',
        a.dream,
        '~~~',
        '### MAIN (your edits)',
        '~~~',
        a.main,
        '~~~',
        '### RESOLVED',
        '~~~',
        a.resolvedContent,
        '~~~',
        '',
      ].join('\n'),
    )
    .join('\n');
  return { path: `conflict_resolutions/${safeBranch}.md`, content: `# Conflict resolution audit — ${branch}\n\n${content}` };
}
