# Claude Agent Instructions

## Critical: Pre-Work Requirements

Before starting ANY task, you MUST:

1. **Read the Project Standards**: Read `docs/standards/index.md` to understand the coding standards, conventions, and best practices for this project.

2. **Read the System Documentation**: Read `docs/systems/index.md` to understand the system architecture, important rules, and technical guidelines.

These documents contain critical rules and context that must inform all work performed in this codebase.

## Workflow

For every task:
1. First, read both index files mentioned above
2. Apply the standards and rules from those documents
3. Proceed with the requested task while adhering to the project guidelines
4. **Run quality checks after implementation** (see below)

Failure to follow this workflow may result in work that doesn't comply with project standards.

## Post-Implementation Quality Checks

After completing ANY implementation, you MUST run the following commands in order:

```bash
bun run lint
bun run format
bun run typecheck
```

These commands ensure code quality, formatting consistency, and type safety.

### For Story/Task Creation

When creating stories or tasks for developers, ALWAYS include a final task:

```markdown
- [ ] **Final Task: Quality Checks**
    - [ ] Run `bun run lint` - Fix any linting issues
    - [ ] Run `bun run format` - Verify code formatting
    - [ ] Run `bun run typecheck` - Ensure type safety
```

This task must be the **last task** in every story, after all implementation and testing tasks.
