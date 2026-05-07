/**
 * AssembleContextUseCase — Story 13.5 / MC5 byte-equivalence.
 *
 * Mirrors Python `app/services/context_assembly.py :: assemble_context()`
 * (lines 86-121). Iterates nine vault file specs in fixed order, dispatches
 * `GetVaultFileCommand` for each, formats present sections as
 * `## <LABEL>\n\n<content>`, optionally appends a `## VAULT HEALTH` section
 * derived from the latest deep-dream's embedded `health_report=...`, and
 * always appends `## MEMORY TOOLS\n\n<MEMORY_TOOLS_TEXT>`. Sections joined
 * with `\n\n`.
 *
 * MEMORY.md is read with `max_lines: 200` (Q4) — vault's `GetVaultFileUseCase`
 * applies the truncation; the use case never sees the raw 200+-line content.
 *
 * Health-report read is the explicit exception to the no-try/catch rule per
 * AC #8 — soft-fail policy is encapsulated INSIDE `getLatestHealthReport()`.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { GetVaultFileCommand, GetVaultFileResult } from 'src/modules/vault/commands/get-vault-file.command';
import { DREAM_REPOSITORY, IDreamRepository } from 'src/shared/domain/repositories/dream.repository.interface';
import { formatHealthSummary, getLatestHealthReport } from '../health-report.helper';

export const MAX_MEMORY_LINES = 200;

// Verbatim port of Python `context_assembly.py:18-24`. Preserved as a single
// concatenated string so the wire output stays byte-equivalent to Python.
export const MEMORY_TOOLS_TEXT =
  'You have access to memory tools during this session:\n' +
  '- `memory_search`: Search past memories semantically. ' +
  "Use when you need context beyond what's in this injected memory.\n" +
  '- `memory_add`: Store a new memory (decision, preference, pattern, ' +
  'correction, fact). Use when you observe important context worth remembering.';

interface SectionSpec {
  label: string;
  path: string;
  maxLines?: number;
}

@Injectable()
export class AssembleContextUseCase {
  private readonly logger = new Logger(AssembleContextUseCase.name);

  constructor(
    private readonly commandBus: CommandBus,
    @Inject(DREAM_REPOSITORY) private readonly dreamRepo: IDreamRepository,
  ) {}

  async execute(): Promise<string> {
    // Server-side date computation in UTC. Matches Python's date.today() because
    // production runs with TZ=UTC. If TZ env changes, document the deviation.
    const today = new Date().toISOString().slice(0, 10);
    const yesterdayDate = new Date(Date.now() - 86_400_000);
    const yesterday = yesterdayDate.toISOString().slice(0, 10);

    const sectionSpecs: SectionSpec[] = [
      { label: 'SOUL', path: 'SOUL.md' },
      { label: 'IDENTITY', path: 'IDENTITY.md' },
      { label: 'MEMORY', path: 'MEMORY.md', maxLines: MAX_MEMORY_LINES },
      { label: `TODAY (${today})`, path: `dailys/${today}.md` },
      { label: `YESTERDAY (${yesterday})`, path: `dailys/${yesterday}.md` },
      { label: 'DECISIONS INDEX', path: 'decisions/_index.md' },
      { label: 'PROJECTS INDEX', path: 'projects/_index.md' },
      { label: 'PATTERNS INDEX', path: 'patterns/_index.md' },
      { label: 'TEMPLATES INDEX', path: 'templates/_index.md' },
    ];

    const sections: string[] = [];
    for (const spec of sectionSpecs) {
      const section = await this.readSection(spec);
      if (section !== null) {
        sections.push(section);
      }
    }

    const healthSection = await this.composeHealthSection();
    if (healthSection !== null) {
      sections.push(healthSection);
    }

    sections.push(`## MEMORY TOOLS\n\n${MEMORY_TOOLS_TEXT}`);

    const assembled = sections.join('\n\n');
    this.logger.log({
      message: 'context assembly completed',
      event: 'context.assembly.completed',
      sectionCount: sections.length,
      length: assembled.length,
    });
    return assembled;
  }

  private async readSection(spec: SectionSpec): Promise<string | null> {
    const result = await this.commandBus.execute<GetVaultFileCommand, GetVaultFileResult>(
      new GetVaultFileCommand({ path: spec.path, max_lines: spec.maxLines }),
    );
    if (result.content === null) {
      this.logger.debug({
        message: 'context section skipped',
        event: 'context.section.skipped',
        section: spec.label,
        path: spec.path,
      });
      return null;
    }
    return `## ${spec.label}\n\n${result.content}`;
  }

  private async composeHealthSection(): Promise<string | null> {
    const report = await getLatestHealthReport(this.dreamRepo, this.logger);
    if (report === null) return null;
    const summary = formatHealthSummary(report);
    if (summary === '') return null;
    return `## VAULT HEALTH\n\n${summary}`;
  }
}
