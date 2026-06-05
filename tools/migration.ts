#!/usr/bin/env bun
import { $ } from 'bun';
import { existsSync } from 'fs';
import { config as loadDotenv } from 'dotenv';

const args = process.argv.slice(2);

function takeFlag(flag: string): string | undefined {
  const idx = args.findIndex((a) => a === flag || a.startsWith(`${flag}=`));
  if (idx === -1) return undefined;
  const arg = args[idx]!;
  const eq = arg.indexOf('=');
  if (eq !== -1) {
    args.splice(idx, 1);
    return arg.slice(eq + 1);
  }
  const value = args[idx + 1];
  args.splice(idx, 2);
  return value;
}

function resolveEnvFile(): string | undefined {
  const explicit = takeFlag('--env');
  if (explicit) {
    if (!existsSync(explicit)) {
      console.error(`Env file not found: ${explicit}`);
      process.exit(1);
    }
    return explicit;
  }

  const nodeEnv = process.env['NODE_ENV'];
  if (nodeEnv) {
    const candidate = `.env.${nodeEnv}`;
    if (existsSync(candidate)) return candidate;
  }

  if (existsSync('.env')) return '.env';
  return undefined;
}

const envFile = resolveEnvFile();
if (envFile) {
  loadDotenv({ path: envFile, override: true });
  console.log(`[migration] loaded env from ${envFile}`);
}

const command = args[0];
const name = args[1];

const MIGRATION_PATH = './src/shared/postgres/migration';
const DATASOURCE = './src/shared/postgres/configs.ts';

async function main() {
  switch (command) {
    case 'create':
      if (!name) {
        console.error('Usage: bun tools/migration.ts create <MigrationName> [--env <file>]');
        process.exit(1);
      }
      await $`./node_modules/.bin/ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli migration:create ${MIGRATION_PATH}/${name}`.throws(
        true,
      );
      break;

    case 'generate':
      if (!name) {
        console.error('Usage: bun tools/migration.ts generate <MigrationName> [--env <file>]');
        process.exit(1);
      }
      await $`./node_modules/.bin/ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli -d ${DATASOURCE} migration:generate ${MIGRATION_PATH}/${name}`.throws(
        true,
      );
      break;

    case 'run':
      await $`./node_modules/.bin/ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli -d ${DATASOURCE} migration:run`.throws(
        true,
      );
      break;

    case 'revert':
      await $`./node_modules/.bin/ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli -d ${DATASOURCE} migration:revert`.throws(
        true,
      );
      break;

    default:
      console.error(`
Usage: bun tools/migration.ts <command> [name] [--env <file>]

Commands:
  create <name>   Create an empty migration file
  generate <name> Generate migration from schema changes
  run             Run pending migrations
  revert          Revert the last migration

Env resolution (highest to lowest priority):
  --env <file>          Explicit override
  .env.<NODE_ENV>       Auto-picked when NODE_ENV is set
  .env                  Default fallback
`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
