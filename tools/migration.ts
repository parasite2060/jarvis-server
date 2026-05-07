#!/usr/bin/env bun
import { $ } from 'bun';

const command = process.argv[2];
const name = process.argv[3];

const MIGRATION_PATH = './src/shared/postgres/migration';
const DATASOURCE = './src/shared/postgres/configs.ts';

async function main() {
  switch (command) {
    case 'create':
      if (!name) {
        console.error('Usage: bun scripts/migration.ts create <MigrationName>');
        process.exit(1);
      }
      await $`./node_modules/.bin/ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli migration:create ${MIGRATION_PATH}/${name}`.throws(
        true,
      );
      break;

    case 'generate':
      if (!name) {
        console.error('Usage: bun scripts/migration.ts generate <MigrationName>');
        process.exit(1);
      }
      await $`./node_modules/.bin/ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli -d ${DATASOURCE} migration:generate ${MIGRATION_PATH}/${name}`.throws(
        true,
      );
      break;

    case 'run':
      await $`bun run build`.throws(true);
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
Usage: bun scripts/migration.ts <command> [name]

Commands:
  create <name>   Create an empty migration file
  generate <name> Generate migration from schema changes
  run             Run pending migrations
  revert          Revert the last migration
`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
