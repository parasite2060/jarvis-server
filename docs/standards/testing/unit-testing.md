# Unit Testing Standards

## Framework & Dependencies

```json
{
  "@nestjs/testing": "^11.0.12",
  "jest": "^29.7.0",
  "@golevelup/ts-jest": "^0.4.0",
  "mongodb-memory-server": "^9.0.0",
  "pg-mem": "^3.0.5"
}
```

## Core Rules

| Rule             | Requirement                           |
| ---------------- | ------------------------------------- |
| Variable for SUT | Use `target` (MANDATORY)              |
| Mock prefix      | `mockServiceName`                     |
| Mock type        | `DeepMocked<T>`                       |
| Pattern          | Arrange-Act-Assert with comments      |
| Coverage         | 80%+ for new code                     |
| Logger           | `.setLogger(new MockLoggerService())` |

## Testing Philosophy

- Test core user flows, not every change
- Defer edge case testing unless business-critical
- Test behavior, not implementation
- Keep tests fast (milliseconds)
- Mock external dependencies

## Standard Test Template

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';

describe('YourClass', () => {
  let target: YourClass; // ✅ MANDATORY: Use 'target'
  let mockDependency: DeepMocked<DependencyClass>;

  beforeEach(async () => {
    // Arrange: Create mocks
    mockDependency = createMock<DependencyClass>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [YourClass, { provide: DependencyClass, useValue: mockDependency }],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = module.get<YourClass>(YourClass);
  });

  it('should do something', async () => {
    // Arrange
    mockDependency.method.mockResolvedValue(expectedValue);

    // Act
    const result = await target.methodUnderTest(input);

    // Assert
    expect(result).toEqual(expectedValue);
    expect(mockDependency.method).toHaveBeenCalledWith(input);
  });
});
```

## Repository Tests (MongoDB In-Memory)

Use `mongodb-memory-server` for repository tests, not mocks.

```typescript
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMongoMemoryServer, getMongooseTestModule } from 'test/helpers/mongodb-test.helper';

describe('YourRepository', () => {
  let target: YourRepository;
  let yourModel: Model<YourDocument>;
  let mongoServer: MongoMemoryServer;

  beforeAll(async () => {
    mongoServer = await createMongoMemoryServer();
    const mongooseModule = getMongooseTestModule(mongoServer);

    const moduleRef = await Test.createTestingModule({
      imports: [mongooseModule, MongooseModule.forFeature([{ name: YourDocument.name, schema: YourSchema }])],
      providers: [YourRepository],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = moduleRef.get<YourRepository>(YourRepository);
    yourModel = moduleRef.get(getModelToken(YourDocument.name));
    await yourModel.createIndexes(); // Required for unique constraints
  }, 60000);

  afterAll(async () => {
    await moduleRef?.close();
    await mongoServer?.stop();
  });

  beforeEach(async () => {
    await yourModel.deleteMany({}); // Clean slate per test
  });

  it('should create and retrieve', async () => {
    const result = await target.create(data);
    const stored = await yourModel.findById(result.id).exec();
    expect(stored).toBeDefined();
  });
});
```

## Repository Tests (PostgreSQL In-Memory)

Use `pg-mem` for PostgreSQL repository tests to verify actual TypeORM queries and schema compliance.

**When to Use:**

- Testing repository implementations that use TypeORM with PostgreSQL
- Verifying SQL queries, indices, and constraints work correctly
- Testing soft deletes, pagination, and complex filtering logic

**When NOT to Use:**

- Usecase/service tests (mock repository interfaces instead)
- E2E tests (use real PostgreSQL containers)

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createPgMemDataSource, PgMemTestHelper } from 'test/helpers/pg-mem.helper';
import { BlogRepositoryImpl } from './blog.repository.impl';
import { BlogSchema } from '../schema/blog.schema';
import { Blog } from 'src/shared/domain/entities/blog.entity';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { DBConnections } from '../utils/constaint';

describe('BlogRepositoryImpl', () => {
  let target: BlogRepositoryImpl;
  let dataSource: DataSource;
  let helper: PgMemTestHelper;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    dataSource = await createPgMemDataSource([BlogSchema]);
    helper = new PgMemTestHelper(dataSource);

    const repository = dataSource.getRepository(BlogSchema);

    moduleRef = await Test.createTestingModule({
      providers: [
        BlogRepositoryImpl,
        {
          provide: getRepositoryToken(BlogSchema, DBConnections.INTERNAL),
          useValue: repository,
        },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = moduleRef.get<BlogRepositoryImpl>(BlogRepositoryImpl);
  }, 60000);

  afterAll(async () => {
    await moduleRef?.close();
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await helper.clearTable(BlogSchema);
  });

  it('should create and persist blog', async () => {
    // Arrange
    const input: Partial<Blog> = {
      title: 'Test Blog',
      content: 'Test Content',
      authorId: 'author-1',
    };

    // Act
    const result = await target.create(input);

    // Assert
    expect(result.id).toBeDefined();
    expect(result.title).toBe('Test Blog');
    expect(result.content).toBe('Test Content');
    expect(result.authorId).toBe('author-1');
    expect(result.isValid).toBe(true);
    await helper.assertRecordExists(BlogSchema, { id: result.id }, input);
  });

  it('should exclude soft-deleted records from findAll', async () => {
    // Arrange
    const blog1 = await target.create({ title: 'Blog 1', content: 'Content 1', authorId: 'author-1' });
    await target.create({ title: 'Blog 2', content: 'Content 2', authorId: 'author-1' });
    await target.softDelete(blog1.id);

    // Act
    const result = await target.findAll({ page: 1, limit: 10 });

    // Assert
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.items[0].title).toBe('Blog 2');
  });
});
```

**Key Differences from Usecase Tests:**

- **Usecase tests:** Mock repository interface → Unit test business logic
- **Repository tests:** Real pg-mem DB → Validate data persistence and SQL behavior

**Helper Utilities:**

- `createPgMemDataSource([schemas])` - Creates in-memory PostgreSQL DataSource using pg-mem
- `helper.assertRecordExists(schema, where, expected)` - Find and verify record
- `helper.assertRecordCount(schema, where, count)` - Count matching records
- `helper.assertSoftDeleted(schema, id)` - Verify soft delete (isValid=false)
- `helper.clearTable(schema)` - Clean table between tests

## Assertion Rules

### Rule 1: Assert Specific Values, Not Just Types

**❌ BAD - Only checks type/existence:**

```typescript
it('should return user', async () => {
  const result = await target.findUser('123');

  expect(result).toBeDefined();
  expect(result.id).toBeDefined();
  expect(typeof result.email).toBe('string');
});
```

**✅ GOOD - Asserts specific values:**

```typescript
it('should return user', async () => {
  // Arrange
  mockRepository.findById.mockResolvedValue({
    id: '123',
    email: 'test@example.com',
    name: 'John Doe',
    role: 'admin',
  });

  // Act
  const result = await target.findUser('123');

  // Assert - Validate ALL properties
  expect(result).toEqual({
    id: '123',
    email: 'test@example.com',
    name: 'John Doe',
    role: 'admin',
  });
});
```

### Rule 2: Tests Must Fail on Incorrect Values

**❌ BAD - Test passes with wrong data:**

```typescript
it('should create user', async () => {
  mockRepository.save.mockResolvedValue({ id: '123' });

  const result = await target.createUser({ email: 'test@example.com', name: 'John' });

  expect(result.id).toBeDefined(); // Passes even if other fields wrong
});
```

**✅ GOOD - Validates all properties and mock calls:**

```typescript
it('should create user', async () => {
  // Arrange
  const input = { email: 'test@example.com', name: 'John Doe', role: 'user' };
  const expected = { id: '123', ...input };
  mockRepository.save.mockResolvedValue(expected);

  // Act
  const result = await target.createUser(input);

  // Assert - Verify result AND mock calls
  expect(result).toEqual(expected);
  expect(mockRepository.save).toHaveBeenCalledWith(input);
  expect(mockRepository.save).toHaveBeenCalledTimes(1);
});
```

### Rule 3: No Conditional Assertions

**❌ BAD - Conditional logic:**

```typescript
it('should handle user lookup', async () => {
  const result = await target.findUser('123');

  if (result) {
    expect(result.email).toBeDefined();
  } else {
    expect(result).toBeNull();
  }
});
```

**✅ GOOD - Separate deterministic tests:**

```typescript
it('should return user when found', async () => {
  // Arrange - Guarantee success
  mockRepository.findById.mockResolvedValue({
    id: '123',
    email: 'test@example.com',
    name: 'John Doe',
  });

  // Act
  const result = await target.findUser('123');

  // Assert
  expect(result).toEqual({
    id: '123',
    email: 'test@example.com',
    name: 'John Doe',
  });
  expect(mockRepository.findById).toHaveBeenCalledWith('123');
});

it('should return null when user not found', async () => {
  // Arrange - Guarantee not found
  mockRepository.findById.mockResolvedValue(null);

  // Act
  const result = await target.findUser('999');

  // Assert
  expect(result).toBeNull();
  expect(mockRepository.findById).toHaveBeenCalledWith('999');
});
```

### Rule 4: Verify Mock Behavior

Always verify mocks were called correctly:

```typescript
it('should call dependencies with correct parameters', async () => {
  // Arrange
  mockEmailService.send.mockResolvedValue(true);
  mockRepository.save.mockResolvedValue({ id: '123' });

  // Act
  await target.createUserAndNotify({ email: 'test@example.com', name: 'John' });

  // Assert - Verify ALL mock interactions
  expect(mockRepository.save).toHaveBeenCalledWith({
    email: 'test@example.com',
    name: 'John',
  });
  expect(mockRepository.save).toHaveBeenCalledTimes(1);
  expect(mockEmailService.send).toHaveBeenCalledWith({
    to: 'test@example.com',
    subject: 'Welcome',
  });
  expect(mockEmailService.send).toHaveBeenCalledTimes(1);
});
```

## Anti-Patterns

| Don't                                       | Why                                     |
| ------------------------------------------- | --------------------------------------- |
| Assert only type/existence                  | Doesn't catch wrong values              |
| Conditional assertions                      | Makes tests non-deterministic           |
| Assert on log calls                         | Couples to implementation, not behavior |
| `jest.spyOn()` on mocks                     | `createMock<T>()` already creates spies |
| Inline mock creation                        | Can't reference mock in tests           |
| Variable names like `controller`, `service` | Use `target` for consistency            |
| Skip mock verification                      | Doesn't validate behavior               |

## What to Test

- ✅ Happy path with valid inputs
- ✅ Error cases (not found, validation)
- ✅ Edge cases (empty results, boundaries)
- ✅ Rollback logic (if applicable)
- ✅ Repository implementations (using mongodb-memory-server or pg-mem)
- ❌ Logger calls
- ❌ Framework behavior

## Checklist

**Setup:**

- [ ] Use `target` for class under test
- [ ] Use `mock` prefix for all mocks
- [ ] Use `DeepMocked<T>` type
- [ ] Include `.setLogger(new MockLoggerService())`
- [ ] Follow AAA pattern with comments
- [ ] Direct mock methods, not `jest.spyOn()`
- [ ] For MongoDB repositories, use `mongodb-memory-server`
- [ ] For PostgreSQL repositories, use `pg-mem`
- [ ] Mock repository interfaces in usecases (not repository implementations)

**Assertions:**

- [ ] Assert specific values, not just types or existence
- [ ] Validate ALL result properties with expected values
- [ ] Verify mock functions called with correct parameters
- [ ] Check mock call counts (`.toHaveBeenCalledTimes()`)
- [ ] No conditional assertions (no `if` statements)
- [ ] Tests fail when any field differs from expectations
- [ ] Separate test cases for different scenarios

**Quality:**

- [ ] 80%+ coverage
- [ ] No assertions on log calls
