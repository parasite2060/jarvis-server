import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { SimpleGit } from 'simple-git';
import type { z } from 'zod';
import type { DeepAgentFactoryAgent } from 'src/shared/agents/deep-agent.factory';
import type { ConflictResolutionOutputSchema } from 'src/modules/dream/agents/conflict-resolution-output.schema';
import { readConflictVersions, isProtected, matchesAllowGlobs } from './conflict-files';
import type { ConflictConfig } from '../read-auto-merge';

export interface ConflictResolutionAudit {
  path: string;
  base: string;
  dream: string;
  main: string;
  resolvedContent: string;
  reasoning: string;
}

export type ConflictSkipReason = 'no-conflicts' | 'protected-file' | 'not-allowlisted' | 'low-confidence';

export interface ResolveConflictResult {
  resolved: boolean;
  reason: ConflictSkipReason | null;
  resolvedFiles: string[];
  skippedFiles: string[];
  audits: ConflictResolutionAudit[];
}

export interface ResolveRebaseConflictDeps {
  git: SimpleGit;
  vaultPath: string;
  conflictedFiles: string[];
  agent: DeepAgentFactoryAgent<typeof ConflictResolutionOutputSchema>;
  config: ConflictConfig;
}

function buildRunPrompt(base: string, dream: string, main: string): string {
  return `BASE:\n${base}\nDREAM:\n${dream}\nMAIN:\n${main}`;
}

export async function resolveRebaseConflict(deps: ResolveRebaseConflictDeps): Promise<ResolveConflictResult> {
  const { git, vaultPath, conflictedFiles, agent, config } = deps;

  if (conflictedFiles.length === 0) {
    return { resolved: false, reason: 'no-conflicts', resolvedFiles: [], skippedFiles: [], audits: [] };
  }

  const resolvedFiles: string[] = [];
  const audits: ConflictResolutionAudit[] = [];

  for (let i = 0; i < conflictedFiles.length; i++) {
    const file = conflictedFiles[i]!;

    if (isProtected(file, config.protectedFiles)) {
      return { resolved: false, reason: 'protected-file', resolvedFiles, skippedFiles: conflictedFiles.slice(i), audits };
    }

    if (!matchesAllowGlobs(file, config.allowGlobs)) {
      return { resolved: false, reason: 'not-allowlisted', resolvedFiles, skippedFiles: conflictedFiles.slice(i), audits };
    }

    const { base, dream, main } = await readConflictVersions(git, file);
    const runPrompt = buildRunPrompt(base, dream, main);
    const output: z.infer<typeof ConflictResolutionOutputSchema> = await agent.invoke(runPrompt);

    if (!output.confident) {
      return { resolved: false, reason: 'low-confidence', resolvedFiles, skippedFiles: conflictedFiles.slice(i), audits };
    }

    await fs.writeFile(path.join(vaultPath, file), output.resolvedContent, 'utf-8');
    await git.add(file);

    audits.push({ path: file, base, dream, main, resolvedContent: output.resolvedContent, reasoning: output.reasoning });
    resolvedFiles.push(file);
  }

  return { resolved: true, reason: null, resolvedFiles, skippedFiles: [], audits };
}
