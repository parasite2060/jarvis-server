import { DataSource, EntitySchema } from 'typeorm';

export class PostgresTestHelper {
  constructor(private readonly dataSource: DataSource) {}

  async assertRecordExists<T>(schema: EntitySchema<T>, where: Partial<T>, expected: Partial<T>): Promise<T> {
    const repo = this.dataSource.getRepository(schema);
    const record = await repo.findOne({ where: where as any });

    expect(record).toBeDefined();
    expect(record).toMatchObject(expected);
    return record as T;
  }

  async assertRecordCount<T>(schema: EntitySchema<T>, where: Partial<T>, expectedCount: number): Promise<void> {
    const repo = this.dataSource.getRepository(schema);
    const count = await repo.count({ where: where as any });
    expect(count).toBe(expectedCount);
  }

  async assertSoftDeleted<T extends { isValid: boolean }>(schema: EntitySchema<T>, id: string): Promise<void> {
    const repo = this.dataSource.getRepository(schema);
    const record = await repo.findOne({ where: { id } as any });

    expect(record).toBeDefined();
    expect(record!.isValid).toBe(false);
  }
}
