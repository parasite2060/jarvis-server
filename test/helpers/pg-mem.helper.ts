import { Provider } from '@nestjs/common';
import { TypeOrmModule, getDataSourceToken } from '@nestjs/typeorm';
import { DataSource, EntitySchema, ObjectLiteral, Repository } from 'typeorm';
import { newDb, DataType, IMemoryDb } from 'pg-mem';
import { randomUUID } from 'crypto';

/**
 * Creates and configures a pg-mem in-memory database with required PostgreSQL functions
 * @returns Configured pg-mem database instance
 */
export function createPgMemDatabase(): IMemoryDb {
  const db = newDb();

  // Register required PostgreSQL functions that TypeORM needs
  db.public.registerFunction({
    name: 'version',
    returns: DataType.text,
    implementation: () => 'PostgreSQL 14.0 (pg-mem)',
  });

  db.public.registerFunction({
    name: 'current_database',
    returns: DataType.text,
    implementation: () => 'test',
  });

  db.public.registerFunction({
    name: 'gen_random_uuid',
    args: [],
    returns: DataType.uuid,
    impure: true,
    implementation: () => {
      return randomUUID();
    },
  });

  db.public.registerFunction({
    name: 'uuid_generate_v4',
    args: [],
    returns: DataType.uuid,
    impure: true,
    implementation: () => {
      return randomUUID();
    },
  });

  db.public.registerFunction({
    name: 'now',
    returns: DataType.timestamptz,
    implementation: () => new Date(),
  });

  return db;
}

/**
 * Creates pg-mem DataSource for PostgreSQL repository testing
 * @param schemas - Array of TypeORM EntitySchema definitions
 * @param connectionName - Optional connection name
 * @returns Promise<DataSource> Initialized TypeORM DataSource connected to pg-mem
 */
export async function createPgMemDataSource(schemas: EntitySchema[], connectionName?: string): Promise<DataSource> {
  const db = createPgMemDatabase();

  const dataSource = await db.adapters.createTypeormDataSource({
    type: 'postgres',
    name: connectionName,
    entities: schemas,
  });

  await dataSource.initialize();
  await dataSource.synchronize();

  return dataSource;
}

/**
 * Creates TypeORM test providers using pg-mem for in-memory PostgreSQL testing
 * Returns TypeOrmModule.forFeature and custom providers for DataSource and Repositories
 *
 * @param dataSource - Initialized pg-mem DataSource
 * @param schemas - Array of TypeORM EntitySchema definitions to register
 * @param connectionName - Optional connection name (must match DataSource connection name)
 * @returns Object containing TypeOrmModule and providers array
 *
 * @example
 * ```typescript
 * const dataSource = await createPgMemDataSource([BlogSchema], DBConnections.INTERNAL);
 * const { typeOrmModule, providers } = getTypeOrmTestProviders(dataSource, [BlogSchema], DBConnections.INTERNAL);
 *
 * const module = await Test.createTestingModule({
 *   imports: [typeOrmModule],
 *   providers: [...providers, BlogRepositoryImpl],
 * }).compile();
 * ```
 */
export function getTypeOrmTestProviders(dataSource: DataSource, schemas: EntitySchema[], connectionName?: string) {
  const providers: Provider[] = [
    {
      provide: connectionName ? getDataSourceToken(connectionName) : getDataSourceToken(),
      useValue: dataSource,
    },
  ];

  return {
    typeOrmModule: TypeOrmModule.forFeature(schemas, connectionName),
    providers,
  };
}

/**
 * Sets up an in-memory PostgreSQL DataSource using pg-mem for testing
 * @param schemas - Array of TypeORM EntitySchema definitions
 * @returns Initialized TypeORM DataSource connected to pg-mem
 * @deprecated Use getTypeOrmTestModule with Test.createTestingModule instead
 */
export async function setupPgMemDataSource(schemas: EntitySchema[]): Promise<DataSource> {
  const db = createPgMemDatabase();

  const dataSource = await db.adapters.createTypeormDataSource({
    type: 'postgres',
    entities: schemas,
  });

  await dataSource.initialize();
  await dataSource.synchronize();

  return dataSource;
}

/**
 * Test helper class providing assertion utilities for pg-mem-based repository tests
 */
export class PgMemTestHelper {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Asserts that a record exists in the database and matches expected values
   * @param schema - EntitySchema to query
   * @param where - Query conditions
   * @param expected - Expected field values
   * @returns The found record
   */
  async assertRecordExists<T extends ObjectLiteral>(schema: EntitySchema, where: Record<string, any>, expected: Record<string, any>): Promise<T> {
    const repo = this.dataSource.getRepository<T>(schema);
    const record = await repo.findOne({ where: where as any });

    expect(record).toBeDefined();
    expect(record).toMatchObject(expected);
    return record as T;
  }

  /**
   * Asserts the count of records matching a query
   * @param schema - EntitySchema to query
   * @param where - Query conditions
   * @param expectedCount - Expected number of records
   */
  async assertRecordCount<T extends ObjectLiteral>(schema: EntitySchema, where: Record<string, any>, expectedCount: number): Promise<void> {
    const repo = this.dataSource.getRepository<T>(schema);
    const count = await repo.count({ where: where as any });
    expect(count).toBe(expectedCount);
  }

  /**
   * Asserts that a record is soft-deleted (isValid = false)
   * @param schema - EntitySchema to query
   * @param id - Record ID
   */
  async assertSoftDeleted<T extends ObjectLiteral & { id: string; isValid: boolean }>(schema: EntitySchema, id: string): Promise<void> {
    const repo = this.dataSource.getRepository<T>(schema);
    const record = await repo.findOne({ where: { id } as any });

    expect(record).toBeDefined();
    expect(record?.isValid).toBe(false);
  }

  /**
   * Clears all records from a table
   * @param schema - EntitySchema to clear
   */
  async clearTable<T extends ObjectLiteral>(schema: EntitySchema): Promise<void> {
    const repo = this.dataSource.getRepository<T>(schema);
    await repo.clear();
  }

  /**
   * Gets a repository instance for direct queries
   * @param schema - EntitySchema to get repository for
   * @returns TypeORM Repository instance
   */
  getRepository<T extends ObjectLiteral>(schema: EntitySchema): Repository<T> {
    return this.dataSource.getRepository<T>(schema);
  }
}
