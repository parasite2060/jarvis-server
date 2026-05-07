---
title: Collaboration Guide
description: Team collaboration workflows, development practices, and quality gates
version: 1.1.0
last_updated: 2025-12-30
repository: https://github.com/thuantan2060/bmad-nestjs-boilerplate
---

# Collaboration Guide

This document outlines team collaboration workflows, development practices, coding standards enforcement, and quality gates for the NestJS + Bun Microservice Template project.

---

## Quick Reference Card

**Essential Commands:**

```bash
# Quality checks (run before every PR)
bun run lint && bun run format && bun run typecheck && bun run test

# Development
bun run start:dev          # Start with hot-reload
bun run test:cov           # Unit tests with coverage
bun run test:e2e           # E2E tests (requires Docker)

# Database
bun run migration:run      # Apply migrations
bun run migration:generate # Generate from entities

# Infrastructure
docker compose up -d       # Start all services
docker compose logs -f     # View logs
```

**Critical Rules (Zero-Tolerance):**

| Rule | Wrong | Correct |
|------|-------|---------|
| Error Handling | `try-catch` for logging | Let errors bubble up |
| Validation | `@IsNotEmpty()` | `@IsNotEmpty({ context: { errorCode: ErrorCode.XXX } })` |
| Logging | Log every operation | Log only at decision points |
| Comments | `// Create blog` | No obvious comments |
| DI Tokens | `@Inject('BlogRepo')` | `@Inject(IBlogRepository)` |

**Must-Read Before Coding:**

1. `docs/standards/index.md` - Standards overview
2. `docs/systems/application-design.md` - Architecture guide

---

## Table of Contents

- [Quick Reference Card](#quick-reference-card)
- [First Day Onboarding](#first-day-onboarding)
- [Purpose and Scope](#purpose-and-scope)
- [Development Workflow](#development-workflow)
- [Standards Framework](#standards-framework)
- [Coding Standards Enforcement](#coding-standards-enforcement)
- [Architecture Patterns](#architecture-patterns)
- [Quality Gates](#quality-gates)
- [Git Workflow](#git-workflow)
- [Testing Guidelines](#testing-guidelines)
- [Domain Events](#domain-events)
- [Database Patterns](#database-patterns)
- [Module Creation](#module-creation)
- [Story Creation for Scrum Masters](#story-creation-for-scrum-masters)
- [Troubleshooting](#troubleshooting)
- [Resources](#resources)

---

## First Day Onboarding

Welcome to the team! Complete this checklist on your first day to get up and running.

### Environment Setup

- [ ] **Install prerequisites**
  - [ ] [Bun](https://bun.sh/docs/installation) (≥1.0.0)
  - [ ] [Docker Desktop](https://www.docker.com/products/docker-desktop/)
  - [ ] IDE with TypeScript support (VS Code recommended)

- [ ] **Clone and setup**
  ```bash
  git clone https://github.com/thuantan2060/bmad-nestjs-boilerplate.git
  cd bmad-nestjs-boilerplate
  bun install
  cp .env.example .env
  ```

- [ ] **Start infrastructure and verify**
  ```bash
  docker compose up -d
  bun run migration:run
  bun run start:dev
  curl http://localhost:3000/health  # Should return {"status":"ok",...}
  ```

### Required Reading (Complete Before First Task)

| Priority | Document | Purpose |
|----------|----------|---------|
| 1 | [README.md](README.md) | Project overview and quick start |
| 2 | [docs/standards/index.md](docs/standards/index.md) | All coding standards |
| 3 | [docs/systems/application-design.md](docs/systems/application-design.md) | Architecture and patterns |
| 4 | This document | Collaboration workflows |

### Explore the Codebase

- [ ] **Study example modules** (in order of complexity):
  1. `src/modules/blog/` - Basic CRUD with PostgreSQL
  2. `src/modules/comment/` - MongoDB + cross-module validation
  3. `src/modules/audit-log/` - Kafka consumer + Factory+Explorer pattern

- [ ] **Run the test suite**
  ```bash
  bun run test        # Unit tests
  bun run test:cov    # With coverage report
  bun run test:e2e    # E2E tests (Docker must be running)
  ```

- [ ] **Make a test change**
  1. Create a branch: `git checkout -b test/your-name-onboarding`
  2. Add a simple unit test to an existing use case
  3. Run quality checks: `bun run lint && bun run format && bun run typecheck`
  4. Verify tests pass: `bun run test`

### Key Contacts

| Role | Responsibility |
|------|----------------|
| Tech Lead | Architecture questions, standards clarification |
| QA Lead | Testing strategy, E2E test issues |
| DevOps | Docker, Kubernetes, deployment issues |

**You're ready to start your first task!** Remember: read the standards, follow the patterns, run quality checks.

---

## Purpose and Scope

This guide ensures:
- **Consistent development practices** across all team members
- **Standards compliance** through mandatory pre-work requirements
- **Quality assurance** via automated checks and code review processes
- **Knowledge sharing** through comprehensive documentation references
- **Efficient collaboration** with clear workflows and responsibilities

---

## Development Workflow

### Pre-Work Requirements (MANDATORY)

**Before starting ANY development task**, you MUST:

1. **Read Project Standards**
   ```
   Read: docs/standards/index.md
   ```
   This index provides role-based reading requirements and outlines all available standards.

2. **Read System Documentation**
   ```
   Read: docs/systems/application-design.md
   ```
   This comprehensive guide explains Clean Architecture, DI patterns, request flows, and component creation.

3. **Understand the Architecture**
   - Study the four-layer Clean Architecture
   - Review existing modules (Blog, Comment, AuditLog) as references
   - Understand CQRS, Repository Pattern, and Domain Events

**Failure to complete pre-work will result in code that doesn't comply with project standards.**

### Feature Development Lifecycle

#### 1. Requirements Analysis
- Review user story and acceptance criteria
- Identify affected modules and components
- Determine which standards apply to the task
- Ask clarifying questions before coding

#### 2. Standards Review (Task 1 in Every Story)
Every story MUST start with:

**Task 1: Read Required Standards**
- [ ] Read `docs/standards/index.md`
- [ ] Read `docs/systems/application-design.md`
- [ ] Read relevant backend standards based on task scope
- [ ] Review testing standards

#### 3. Implementation
- Follow coding standards from `docs/standards/`
- Write clean, testable code
- Use established patterns (Repository, Factory, CQRS)
- Add necessary documentation

#### 4. Testing
- Write unit tests (≥80% coverage)
- Write E2E tests for user-facing features
- Follow AAA pattern (Arrange-Act-Assert)
- Validate against acceptance criteria

#### 5. Code Review
- Self-review against coding standards
- Submit pull request with standards references
- Address reviewer feedback
- Ensure CI checks pass

#### 6. Quality Checks (Final Task in Every Story)
**Final Task: Quality Checks**
- [ ] Run `bun run lint` - Fix any linting issues
- [ ] Run `bun run format` - Verify code formatting
- [ ] Run `bun run typecheck` - Ensure type safety
- [ ] Run `bun run test` - All unit tests pass
- [ ] Run `bun run test:e2e` - All E2E tests pass (if applicable)

---

## Standards Framework

### Overview

The `docs/standards/` directory contains comprehensive coding standards organized by category:

```
docs/standards/
├── backend/          # Backend development standards
│   ├── coding-style.md
│   ├── error-handling.md
│   ├── logging.md
│   ├── validation.md
│   ├── domain-events.md
│   ├── usecases.md
│   ├── kafka.md
│   ├── design-pattern-factory.md
│   ├── design-pattern-factory-and-explorer.md
│   └── design-pattern-chain-of-responsibility.md
├── testing/          # Testing standards
│   ├── unit-testing.md
│   └── e2e-testing.md
└── global/           # Universal standards
    ├── commenting.md
    ├── security.md
    ├── code-quality.md
    └── conventions.md
```

### Role-Based Reading Requirements

| Role | Mandatory Standards | Optional Standards |
|------|--------------------|--------------------|
| **Backend Developer** | coding-style, error-handling, logging, validation, domain-events, usecases, unit-testing, commenting, code-quality | kafka, design-patterns, e2e-testing |
| **Full-Stack Developer** | All Backend + e2e-testing | Frontend standards (when available) |
| **QA Engineer** | unit-testing, e2e-testing, code-quality | All backend standards |
| **Scrum Master** | All standards overview | N/A |
| **Architect** | All standards | N/A |

### When to Read Which Standards

**By Task Type:**

| Task Type | Required Standards |
|-----------|-------------------|
| **New CRUD Module** | coding-style, usecases, validation, error-handling, domain-events, unit-testing |
| **Event Handler** | domain-events, kafka, design-pattern-factory-and-explorer, error-handling |
| **API Endpoint** | coding-style, usecases, validation, error-handling, logging |
| **Bug Fix** | error-handling, logging, coding-style, unit-testing |
| **Refactoring** | coding-style, code-quality, commenting, unit-testing |
| **Testing** | unit-testing, e2e-testing, code-quality |

### Standards Conflict Resolution

If standards appear to conflict:
1. Reference `docs/systems/application-design.md` for architectural decisions
2. Consult tech lead or architect
3. Document the decision in the PR description
4. Update standards if necessary (via separate PR)

---

## Coding Standards Enforcement

### Critical Rules (Zero-Tolerance)

#### 1. Error Handling
**Rule:** No try-catch blocks for logging purposes

❌ **WRONG:**
```typescript
try {
  await this.blogRepository.create(blog);
} catch (error) {
  this.logger.error('Failed to create blog', error); // Don't log here
  throw error;
}
```

✅ **CORRECT:**
```typescript
// Let errors bubble - logging happens at infrastructure layer
await this.blogRepository.create(blog);
```

**Reference:** [Error Handling Standard](docs/standards/backend/error-handling.md)

#### 2. Validation
**Rule:** Always include ErrorCode context in validation errors

❌ **WRONG:**
```typescript
@IsNotEmpty()
title: string;
```

✅ **CORRECT:**
```typescript
@IsNotEmpty({ context: { errorCode: ErrorCode.BLG_INVALID_TITLE } })
title: string;
```

**Reference:** [Validation Standard](docs/standards/backend/validation.md)

#### 3. Logging
**Rule:** Minimal logging - only log at decision points

❌ **WRONG:**
```typescript
this.logger.log('Starting to create blog'); // Unnecessary
const blog = await this.blogRepository.create(data);
this.logger.log('Blog created successfully'); // Unnecessary
```

✅ **CORRECT:**
```typescript
// No logging - operation is straightforward
const blog = await this.blogRepository.create(data);

// Only log at decision points
if (!blog) {
  this.logger.warn('Blog creation returned null - unexpected state');
}
```

**Reference:** [Logging Standard](docs/standards/backend/logging.md)

#### 4. Commenting
**Rule:** Zero-tolerance for obvious comments

❌ **WRONG:**
```typescript
// Create blog
const blog = await this.blogRepository.create(data);

// Return response
return HttpApiResponse.success(blog);
```

✅ **CORRECT:**
```typescript
const blog = await this.blogRepository.create(data);
return HttpApiResponse.success(blog);

// Only comment when explaining WHY (non-obvious decisions):
// Using factory pattern to handle multiple payment providers (Stripe, PayPal)
const processor = this.paymentProcessorFactory.getProcessor(request.provider);
```

**Reference:** [Commenting Standard](docs/standards/global/commenting.md)

#### 5. Response Patterns
**Rule:** Use Presenter for GET, Response Model for mutations

✅ **GET Endpoints (Use Presenter):**
```typescript
@Get(':id')
async getBlog(@Param('id') id: string): Promise<HttpApiResponse<BlogPresenter>> {
  const blog = await this.getBlogUseCase.execute({ id });
  const presenter = BlogPresenter.from(blog);
  return HttpApiResponse.success(presenter);
}
```

✅ **POST/PUT/DELETE Endpoints (Use Response Model):**
```typescript
@Post()
async createBlog(@Body() request: CreateBlogRequest): Promise<HttpApiResponse<CreateBlogResponse>> {
  const response = await this.createBlogUseCase.execute(request);
  return HttpApiResponse.success(response);
}
```

**Reference:** [Use Cases Standard](docs/standards/backend/usecases.md)

#### 6. Dependency Injection
**Rule:** Use Symbol tokens, never string literals

❌ **WRONG:**
```typescript
@Inject('BlogRepository')
private readonly blogRepository: IBlogRepository;
```

✅ **CORRECT:**
```typescript
@Inject(IBlogRepository)
private readonly blogRepository: IBlogRepository;

// Where IBlogRepository is defined as:
export const IBlogRepository = Symbol('IBlogRepository');
export interface IBlogRepository { ... }
```

**Reference:** [Application Design Guide](docs/systems/application-design.md) - Dependency Injection section

---

## Architecture Patterns

### Repository Pattern

**Interface Location:** `src/shared/domain/repositories/`
**Implementation Location:** `src/shared/postgres/repository/` OR `src/shared/mongo/repositories/`

**Example:**
```typescript
// src/shared/domain/repositories/blog.repository.interface.ts
export const IBlogRepository = Symbol('IBlogRepository');
export interface IBlogRepository {
  create(blog: Blog): Promise<Blog>;
  findById(id: string): Promise<Blog | null>;
  update(blog: Blog): Promise<Blog>;
  delete(id: string): Promise<void>;
}

// src/shared/postgres/repository/blog.repository.impl.ts
@Injectable()
export class BlogRepositoryImpl implements IBlogRepository {
  constructor(@InjectRepository(BlogSchema) private readonly repository: Repository<BlogSchema>) {}

  async create(blog: Blog): Promise<Blog> {
    const schema = BlogSchema.fromDomain(blog);
    const saved = await this.repository.save(schema);
    return saved.toDomain();
  }
}

// src/shared/postgres/postgres.module.ts
providers: [
  { provide: IBlogRepository, useClass: BlogRepositoryImpl }
]
```

### Factory Pattern

**Use Case:** Dynamic strategy selection based on runtime input

**Pattern:** Symbol tokens + Map registry

**Example:**
```typescript
// providers/payment-processor.provider.ts
export const PAYMENT_PROCESSOR_TOKEN = Symbol('PAYMENT_PROCESSOR_TOKEN');

// factory/payment-processor.factory.ts
@Injectable()
export class PaymentProcessorFactory {
  private processors = new Map<string, IPaymentProcessor>();

  constructor(
    @Inject(STRIPE_PROCESSOR) stripeProcessor: IPaymentProcessor,
    @Inject(PAYPAL_PROCESSOR) paypalProcessor: IPaymentProcessor,
  ) {
    this.processors.set('stripe', stripeProcessor);
    this.processors.set('paypal', paypalProcessor);
  }

  getProcessor(provider: string): IPaymentProcessor {
    const processor = this.processors.get(provider);
    if (!processor) {
      throw new NotFoundException(`Payment processor not found: ${provider}`);
    }
    return processor;
  }
}
```

**Reference:** [Factory Pattern](docs/standards/backend/design-pattern-factory.md)

### Factory + Explorer Pattern

**Use Case:** Automatic handler discovery with custom decorators

**Example:** AuditLog module domain event handlers

**Components:**
1. **Interface:** `IDomainEventHandler<TPayload>`
2. **Decorator:** `@InjectableDomainEventHandler(eventCode)`
3. **Explorer:** Scans modules for decorated handlers
4. **Factory:** Resolves handlers by event code at runtime

**Reference:** [Factory + Explorer Pattern](docs/standards/backend/design-pattern-factory-and-explorer.md)

### Domain Events

**Pattern:** Auto-publishing to Kafka via EventBus

**Event Code Format:** `ORG{ModuleNum}{EventNum}`
- Blog: ORG01xxx
- Comment: ORG02xxx
- AuditLog: ORG03xxx

**Publishing:**
```typescript
// In use case
const event = new BlogCreatedEvent(blog, { refId: blog.id, actor, source });
await this.eventBus.publish(event);

// DomainEventsHandler automatically forwards to Kafka
```

**Consuming:**
```typescript
// In AuditLog module
@EventPattern(`org-${process.env['RUNTIME_ENV']}-domain-event`)
async handleDomainEvent(@Payload() event: DomainEventDto): Promise<RpcApiResponse<void>> {
  await this.handleDomainEventUseCase.execute(event);
  return RpcApiResponse.success();
}
```

**Reference:** [Domain Events Standard](docs/standards/backend/domain-events.md)

### CQRS

**Commands:** Cross-module communication (use cases calling other modules)
**Events:** Notification after state changes (domain events)

**Example:**
```typescript
// Command - synchronous request/response
const blog = await this.commandBus.execute(new GetBlogCommand(blogId));

// Event - fire-and-forget notification
await this.eventBus.publish(new BlogCreatedEvent(blog, metadata));
```

**Reference:** [Use Cases Standard](docs/standards/backend/usecases.md)

---

## Quality Gates

### Post-Implementation Quality Checks (MANDATORY)

**All checks MUST pass before submitting PR:**

#### 1. Linting
```bash
bun run lint
```

**Requirements:**
- Zero errors
- Zero warnings (strict mode)
- Husky pre-commit hook enforces automatically

#### 2. Code Formatting
```bash
bun run format
```

**Requirements:**
- All files formatted with Prettier
- Consistent code style across project

#### 3. Type Checking
```bash
bun run typecheck
```

**Requirements:**
- Zero TypeScript errors
- Strict mode enabled
- All generics properly typed

#### 4. Unit Tests
```bash
bun run test
bun run test:cov
```

**Requirements:**
- All tests pass
- ≥80% code coverage for new code
- AAA pattern (Arrange-Act-Assert)
- Mock naming convention (`mockXxx` prefix)

#### 5. E2E Tests
```bash
bun run test:e2e
```

**Requirements:**
- All E2E tests pass
- New user-facing features have E2E tests
- 8-second waits for Kafka event propagation

### Code Review Checklist

**Reviewer MUST verify:**

- [ ] **Standards Compliance**
  - [ ] Error handling: No try-catch for logging
  - [ ] Validation: ErrorCode context included
  - [ ] Logging: Minimal, at decision points only
  - [ ] Commenting: No obvious comments
  - [ ] Response patterns: Presenter vs Response Model

- [ ] **Test Coverage**
  - [ ] Unit tests: ≥80% coverage
  - [ ] E2E tests for user-facing features
  - [ ] AAA pattern followed
  - [ ] Edge cases covered

- [ ] **Error Handling**
  - [ ] Errors bubble up naturally
  - [ ] Error codes defined in ErrorCode
  - [ ] Meaningful error messages

- [ ] **Logging Appropriateness**
  - [ ] No verbose logging
  - [ ] Structured JSON format
  - [ ] Correlation IDs included (auto by interceptor)

- [ ] **Type Safety**
  - [ ] No `any` types without justification
  - [ ] Interfaces over type aliases
  - [ ] Generic types properly constrained

- [ ] **Architecture Compliance**
  - [ ] Clean Architecture layers respected
  - [ ] Repository interfaces in domain layer
  - [ ] Use cases orchestrate business logic
  - [ ] Controllers are thin (protocol concerns only)

---

## Git Workflow

### Branch Naming Conventions

```
<type>/<ticket-number>-<short-description>

Examples:
feature/PROJ-123-add-payment-module
bugfix/PROJ-456-fix-blog-validation
refactor/PROJ-789-improve-error-handling
docs/PROJ-101-update-readme
```

**Types:**
- `feature/` - New features
- `bugfix/` - Bug fixes
- `hotfix/` - Critical production fixes
- `refactor/` - Code refactoring
- `docs/` - Documentation updates
- `test/` - Test additions/fixes
- `chore/` - Build, CI, dependencies

### Commit Message Format

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

**Example:**
```
feat(blog): add soft-delete functionality

Implement soft-delete pattern using isValid field.
Domain events published on deletion.

Refs: PROJ-123
```

**Types:**
- `feat` - New feature
- `fix` - Bug fix
- `refactor` - Code refactoring
- `docs` - Documentation
- `test` - Test updates
- `chore` - Build/tooling changes

### Pull Request Process

#### 1. Before Creating PR
- [ ] All quality checks pass
- [ ] Code self-reviewed against standards
- [ ] Tests added and passing
- [ ] Documentation updated

#### 2. PR Description Template

```markdown
## Description
Brief description of changes

## Standards References
- [ ] Read docs/standards/index.md
- [ ] Read docs/systems/application-design.md
- [ ] Followed [specific standard]: docs/standards/backend/xxx.md

## Changes
- Bullet list of changes

## Testing
- [ ] Unit tests added/updated
- [ ] E2E tests added/updated (if applicable)
- [ ] Manual testing completed

## Quality Checks
- [ ] `bun run lint` - Passed
- [ ] `bun run format` - Passed
- [ ] `bun run typecheck` - Passed
- [ ] `bun run test` - Passed
- [ ] `bun run test:e2e` - Passed

## Related Issues
Closes #123
Refs #456
```

#### 3. Code Review
- At least 1 approval required
- Address all comments before merging
- Resolve conflicts with base branch

#### 4. Merge Requirements
- [ ] All CI checks pass
- [ ] Code review approved
- [ ] No merge conflicts
- [ ] Quality gates passed

---

## Testing Guidelines

### Unit Test Structure

**Framework:** Jest with @golevelup/ts-jest

**Naming Convention:**
```typescript
describe('CreateBlogUseCase', () => {
  let target: CreateBlogUseCase; // Use 'target' for system under test
  let mockBlogRepository: DeepMocked<IBlogRepository>;
  let mockEventBus: DeepMocked<EventBus>;

  beforeEach(async () => {
    mockBlogRepository = createMock<IBlogRepository>();
    mockEventBus = createMock<EventBus>();
    // ... setup module
  });

  it('should create blog and publish event', async () => {
    // Arrange
    const request = new CreateBlogRequest();
    mockBlogRepository.create.mockResolvedValue(expectedBlog);

    // Act
    const result = await target.execute(request);

    // Assert
    expect(result).toBeDefined();
    expect(mockBlogRepository.create).toHaveBeenCalledTimes(1);
    expect(mockEventBus.publish).toHaveBeenCalledWith(expect.any(BlogCreatedEvent));
  });
});
```

**Key Requirements:**
- Use AAA pattern (Arrange-Act-Assert)
- Variable name `target` for system under test
- Mock prefix for dependencies (`mockXxx`)
- `@golevelup/ts-jest` for creating mocks
- ≥80% coverage

**Reference:** [Unit Testing Standard](docs/standards/testing/unit-testing.md)

### E2E Test Setup

**Infrastructure:** docker-compose.e2e.yml

**Start Infrastructure:**
```bash
bun run e2e:infra:up
```

**Run Tests:**
```bash
bun run test:e2e
```

**Structure:**
```typescript
describe('Blog E2E', () => {
  let app: INestApplication;
  let postgresHelper: E2EPostgresHelper;
  let mongoHelper: E2EMongoHelper;
  let kafkaHelper: E2EKafkaHelper;

  beforeAll(async () => {
    // Setup from test/setup/e2e-setup.ts
    const setup = await E2ESetup.create();
    app = setup.app;
    // ... initialize helpers
  });

  afterAll(async () => {
    await app.close();
  });

  it('should create blog and publish event to Kafka', async () => {
    // Arrange
    const createRequest = { title: 'Test', content: 'Content', authorId: '123' };

    // Act
    const response = await request(app.getHttpServer())
      .post('/blogs')
      .send(createRequest)
      .expect(201);

    // Wait for Kafka event propagation (8 seconds per standards)
    await kafkaHelper.wait(8000);

    // Assert
    const auditLogs = await mongoHelper.findAuditLogs({ entityId: response.body.data.id });
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].eventCode).toBe('ORG01001');
  });
});
```

**Key Requirements:**
- 8-second waits for Kafka events
- Helpers for database cleanup
- Factory functions for test data
- E2E environment (.env.e2e)

**Reference:** [E2E Testing Standard](docs/standards/testing/e2e-testing.md)

### Test Data Factories

**Location:** `test/factories/`

**Example:**
```typescript
// test/factories/blog.factory.ts
export class BlogFactory {
  static create(overrides?: Partial<Blog>): Blog {
    return new Blog({
      id: faker.string.uuid(),
      title: faker.lorem.sentence(),
      content: faker.lorem.paragraphs(),
      authorId: faker.string.uuid(),
      isValid: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });
  }

  static createRequest(overrides?: Partial<CreateBlogRequest>): CreateBlogRequest {
    return {
      title: faker.lorem.sentence(),
      content: faker.lorem.paragraphs(),
      authorId: faker.string.uuid(),
      ...overrides,
    };
  }
}
```

### Mock Patterns

**Repository Mocking:**
```typescript
mockBlogRepository = createMock<IBlogRepository>();
mockBlogRepository.findById.mockResolvedValue(BlogFactory.create());
```

**EventBus Mocking:**
```typescript
mockEventBus = createMock<EventBus>();
mockEventBus.publish.mockResolvedValue(undefined);
```

**Test Isolation:**
- Each test is independent
- No shared state between tests
- Database cleanup in E2E tests

---

## Domain Events

### Event Code Format

```
ORG{ModuleNum}{EventNum}

Examples:
ORG01001 - Blog Created
ORG01002 - Blog Updated
ORG01003 - Blog Deleted
ORG02001 - Comment Created
ORG02002 - Comment Deleted
```

**Allocation:**
- ORG01xxx - Blog module
- ORG02xxx - Comment module
- ORG03xxx - AuditLog module
- ORG04xxx - Next module...

### Publishing Pattern

**In Use Case:**
```typescript
@Injectable()
export class CreateBlogUseCase {
  constructor(
    @Inject(IBlogRepository) private readonly blogRepository: IBlogRepository,
    private readonly eventBus: EventBus,
  ) {}

  async execute(request: CreateBlogRequest): Promise<CreateBlogResponse> {
    const blog = Blog.create(request);
    const savedBlog = await this.blogRepository.create(blog);

    // Publish domain event
    const event = new BlogCreatedEvent(
      savedBlog,
      {
        refId: savedBlog.id,
        actor: { id: request.authorId, name: 'User' },
        source: { service: 'blog-service', module: 'blog' },
      }
    );
    await this.eventBus.publish(event);

    return CreateBlogResponse.from(savedBlog);
  }
}
```

### Auto Kafka Publishing

**DomainEventsHandler** (in shared/event) automatically forwards all DomainEvents to Kafka:

```typescript
@EventsHandler(DomainEvent)
export class DomainEventsHandler {
  async handle(event: DomainEvent): Promise<void> {
    // Auto-publishes to Kafka topic: org-{env}-domain-event
    await this.kafkaProducer.send({
      topic: `org-${process.env.RUNTIME_ENV}-domain-event`,
      messages: [{ value: JSON.stringify(event) }],
    });
  }
}
```

### Handler Discovery (Factory+Explorer)

**Decorator:**
```typescript
@Injectable()
@InjectableDomainEventHandler('ORG01001', BlogCreatedPayload)
export class BlogCreatedHandler implements IDomainEventHandler<BlogCreatedPayload> {
  async handle(event: DomainEventDto<BlogCreatedPayload>): Promise<void> {
    // Payload already validated by decorator
    await this.createAuditLogUseCase.execute(event);
  }
}
```

**Bootstrap (in module):**
```typescript
@Module({
  providers: [
    ...DomainEventHandlers,
    DomainEventHandlerFactory,
    DomainEventHandlerExplorer,
  ],
})
export class AuditLogModule implements OnApplicationBootstrap {
  onApplicationBootstrap(): void {
    const { eventHandlers } = this.explorer.explore();
    this.factory.register(eventHandlers);
  }
}
```

**Reference:** [Domain Events Standard](docs/standards/backend/domain-events.md)

---

## Database Patterns

### Repository Interface Location

**Domain Layer:** `src/shared/domain/repositories/`

```typescript
// src/shared/domain/repositories/blog.repository.interface.ts
export const IBlogRepository = Symbol('IBlogRepository');

export interface IBlogRepository {
  create(blog: Blog): Promise<Blog>;
  findById(id: string): Promise<Blog | null>;
  findAll(filter: BlogFilter): Promise<Blog[]>;
  update(blog: Blog): Promise<Blog>;
  delete(id: string): Promise<void>;
}
```

### Repository Implementation

**PostgreSQL:** `src/shared/postgres/repository/`
**MongoDB:** `src/shared/mongo/repositories/`

```typescript
// src/shared/postgres/repository/blog.repository.impl.ts
@Injectable()
export class BlogRepositoryImpl implements IBlogRepository {
  constructor(
    @InjectRepository(BlogSchema)
    private readonly repository: Repository<BlogSchema>,
  ) {}

  async create(blog: Blog): Promise<Blog> {
    const schema = BlogSchema.fromDomain(blog);
    const saved = await this.repository.save(schema);
    return saved.toDomain();
  }
}
```

### DI Wiring

**PostgreSQL Module:**
```typescript
// src/shared/postgres/postgres.module.ts
@Module({
  imports: [TypeOrmModule.forFeature([BlogSchema])],
  providers: [
    { provide: IBlogRepository, useClass: BlogRepositoryImpl },
  ],
  exports: [IBlogRepository],
})
export class PostgresModule {}
```

**MongoDB Module:**
```typescript
// src/shared/mongo/mongo.module.ts
@Module({
  imports: [MongooseModule.forFeature([{ name: CommentSchema.name, schema: CommentSchema.schema }])],
  providers: [
    { provide: ICommentRepository, useClass: CommentRepositoryImpl },
  ],
  exports: [ICommentRepository],
})
export class MongoModule {}
```

### Migration Workflow

**Create Migration:**
```bash
bun run migration:create MigrationName
```

**Generate from Entities:**
```bash
bun run migration:generate MigrationName
```

**Run Migrations:**
```bash
bun run migration:run
```

**Revert Last Migration:**
```bash
bun run migration:revert
```

### Soft Delete Pattern

**Use `isValid` field instead of hard deletes:**

```typescript
export class Blog {
  id: string;
  title: string;
  content: string;
  authorId: string;
  isValid: boolean; // Soft-delete flag
  createdAt: Date;
  updatedAt: Date;

  delete(): void {
    this.isValid = false;
    this.updatedAt = new Date();
  }
}
```

**Repository Implementation:**
```typescript
async delete(id: string): Promise<void> {
  await this.repository.update({ id }, { isValid: false, updatedAt: new Date() });
}

async findById(id: string): Promise<Blog | null> {
  const schema = await this.repository.findOne({
    where: { id, isValid: true }, // Filter out soft-deleted
  });
  return schema?.toDomain() || null;
}
```

---

## Module Creation

### When to Create a New Module

Create a new module when:
- Represents a distinct business capability (e.g., Orders, Inventory)
- Has its own data model and business rules
- Can be developed and tested independently
- May need to scale independently in the future

### Module Structure

```
src/modules/<module-name>/
├── usecases/                    # Application logic
│   ├── create-<entity>.usecase.ts
│   ├── get-<entity>.usecase.ts
│   ├── update-<entity>.usecase.ts
│   ├── delete-<entity>.usecase.ts
│   └── index.ts                 # Export all use cases
├── models/
│   ├── requests/                # DTOs for incoming requests
│   │   ├── create-<entity>.request.ts
│   │   └── update-<entity>.request.ts
│   ├── responses/               # Response models for mutations
│   │   ├── create-<entity>.response.ts
│   │   └── update-<entity>.response.ts
│   └── presenters/              # Presenters for GET endpoints
│       └── <entity>.presenter.ts
├── events/                      # Domain events
│   ├── <entity>-created.event.ts
│   ├── <entity>-updated.event.ts
│   └── <entity>-deleted.event.ts
├── <module-name>.controller.ts  # Single controller per module
└── <module-name>.module.ts      # Module definition
```

### Controller Patterns

**Single Controller Per Module:**
```typescript
@Controller('blogs')
export class BlogController {
  constructor(
    private readonly createBlogUseCase: CreateBlogUseCase,
    private readonly getBlogUseCase: GetBlogUseCase,
    private readonly listBlogsUseCase: ListBlogsUseCase,
    private readonly updateBlogUseCase: UpdateBlogUseCase,
    private readonly deleteBlogUseCase: DeleteBlogUseCase,
  ) {}

  @Post()
  async create(@Body() request: CreateBlogRequest): Promise<HttpApiResponse<CreateBlogResponse>> {
    const response = await this.createBlogUseCase.execute(request);
    return HttpApiResponse.success(response);
  }

  @Get(':id')
  async getById(@Param('id') id: string): Promise<HttpApiResponse<BlogPresenter>> {
    const blog = await this.getBlogUseCase.execute({ id });
    return HttpApiResponse.success(BlogPresenter.from(blog));
  }
}
```

### Module Registration

**Add to app.module.ts:**
```typescript
@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    PostgresModule,
    MongoModule,
    EventModule,
    HealthModule,
    BlogModule,       // ← Add new module
    CommentModule,
    AuditLogModule,
  ],
})
export class AppModule {}
```

---

## Story Creation (for Scrum Masters)

### Mandatory Tasks in Every Story

#### Task 1: Read Required Standards (FIRST TASK)

**Must include:**
```markdown
### Task 1: Read Required Standards

**Objective:** Understand project standards and architecture before implementation

**Subtasks:**
- [ ] Read `docs/standards/index.md` - Standards overview and role-based requirements
- [ ] Read `docs/systems/application-design.md` - Clean Architecture and DI patterns
- [ ] Read relevant backend standards:
  - [ ] `docs/standards/backend/coding-style.md`
  - [ ] `docs/standards/backend/error-handling.md`
  - [ ] `docs/standards/backend/validation.md`
  - [ ] [Other standards based on task scope]
- [ ] Review testing standards:
  - [ ] `docs/standards/testing/unit-testing.md`
  - [ ] `docs/standards/testing/e2e-testing.md` (if applicable)

**Expected Outcome:** Developer understands standards and is ready to implement feature correctly
```

#### Final Task: Quality Checks (LAST TASK)

**Must include:**
```markdown
### Final Task: Quality Checks

**Objective:** Ensure code quality, type safety, and test coverage before PR submission

**Subtasks:**
- [ ] Run `bun run lint` - Fix any linting issues (zero errors, zero warnings)
- [ ] Run `bun run format` - Verify code formatting with Prettier
- [ ] Run `bun run typecheck` - Ensure TypeScript type safety (zero errors)
- [ ] Run `bun run test` - All unit tests pass with ≥80% coverage
- [ ] Run `bun run test:e2e` - All E2E tests pass (if applicable)

**Expected Outcome:** All quality gates pass, ready for code review
```

### Acceptance Criteria Patterns

**Use Given-When-Then format:**

```markdown
## Acceptance Criteria

### AC1: Create Blog with Valid Data
- **Given** a valid blog creation request
- **When** the user sends POST /blogs
- **Then** the blog should be created in the database
- **And** a BlogCreatedEvent should be published to Kafka
- **And** HTTP 201 Created should be returned
- **And** the response should match the CreateBlogResponse model

### AC2: Validate Required Fields
- **Given** a blog creation request with missing title
- **When** the user sends POST /blogs
- **Then** HTTP 400 Bad Request should be returned
- **And** the error should include ErrorCode.BLG_INVALID_TITLE
```

### Story Template

```markdown
# Story: [Feature Name]

## Description
[Brief description of the feature]

## Context
[Background information, why this is needed]

## Tasks

### Task 1: Read Required Standards
[Use mandatory template above]

### Task 2: [Implementation Task]
[Task details]

### Task 3: [Testing Task]
[Task details]

### Final Task: Quality Checks
[Use mandatory template above]

## Acceptance Criteria
[Use Given-When-Then format]

## Technical Notes
- Standards to follow: [List specific standards]
- Patterns to use: [Repository, Factory, etc.]
- Modules affected: [Blog, Comment, etc.]

## Definition of Done
- [ ] All tasks completed
- [ ] All acceptance criteria met
- [ ] Code reviewed and approved
- [ ] Quality checks passed
- [ ] Documentation updated (if applicable)
```

---

## Troubleshooting

> **Note:** For infrastructure setup issues (Docker, ports, environment variables), see the [README Troubleshooting section](README.md#troubleshooting).

### Common Issues and Solutions

#### E2E Test Failures

**Issue:** Kafka events not received in tests

**Solution:**
```typescript
// Ensure 8-second wait for Kafka propagation
await kafkaHelper.wait(8000);
```

**Issue:** Database connection timeout

**Solution:**
```bash
# Check infrastructure is running
bun run e2e:infra:up

# Verify containers are healthy
docker compose -f docker-compose.e2e.yml ps
```

#### Docker Build Issues

**Issue:** Build fails with "Cannot find module"

**Solution:**
```bash
# Clean build cache
docker system prune -a

# Rebuild without cache
docker build --no-cache --target production -t nestjs-app:latest .
```

**Issue:** Permission denied errors

**Solution:**
```dockerfile
# Ensure correct permissions in Dockerfile
USER nonroot:65532
```

#### Kafka Connection Problems

**Issue:** Kafka connection refused

**Solution:**
```bash
# Check Kafka is running
docker compose ps kafka

# Restart Kafka
docker compose restart kafka

# Check KAFKA_DEFAULT_BROKER_URL in .env
```

#### Database Migration Errors

**Issue:** Migration fails with "relation already exists"

**Solution:**
```bash
# Revert last migration
bun run migration:revert

# Regenerate migration
bun run migration:generate FixMigrationName

# Run migrations
bun run migration:run
```

### Getting Help

1. **Check Documentation:**
   - Standards: `docs/standards/`
   - Architecture: `docs/systems/application-design.md`
   - Deployment: `docs/deployment/kubernetes-docker.md`

2. **Review Example Modules:**
   - Blog module (PostgreSQL)
   - Comment module (MongoDB)
   - AuditLog module (Kafka + Factory+Explorer)

3. **Open an Issue:**
   - [GitHub Issues](https://github.com/thuantan2060/bmad-nestjs-boilerplate/issues)

4. **Consult Team:**
   - Tech lead for architecture questions
   - QA for testing issues
   - DevOps for deployment problems

---

## Resources

### Repository

- **[GitHub Repository](https://github.com/thuantan2060/bmad-nestjs-boilerplate)** - Source code and issue tracking

### Internal Documentation

- **[Standards Index](docs/standards/index.md)** - Complete list of coding standards with role-based requirements
- **[Application Design Guide](docs/systems/application-design.md)** - Clean Architecture, CQRS, DDD patterns
- **[Kubernetes Deployment](docs/deployment/kubernetes-docker.md)** - Production deployment guide

### Backend Standards

- [Coding Style](docs/standards/backend/coding-style.md)
- [Error Handling](docs/standards/backend/error-handling.md)
- [Logging](docs/standards/backend/logging.md)
- [Validation](docs/standards/backend/validation.md)
- [Domain Events](docs/standards/backend/domain-events.md)
- [Use Cases](docs/standards/backend/usecases.md)
- [Kafka](docs/standards/backend/kafka.md)
- [Design Patterns](docs/standards/backend/)

### Testing Standards

- [Unit Testing](docs/standards/testing/unit-testing.md)
- [E2E Testing](docs/standards/testing/e2e-testing.md)

### External Resources

- [NestJS Documentation](https://docs.nestjs.com/)
- [Bun Documentation](https://bun.sh/docs)
- [TypeORM Documentation](https://typeorm.io/)
- [Mongoose Documentation](https://mongoosejs.com/docs/)
- [KafkaJS Documentation](https://kafka.js.org/)
- [Clean Architecture by Uncle Bob](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- [CQRS Pattern](https://martinfowler.com/bliki/CQRS.html)
- [Domain-Driven Design](https://martinfowler.com/tags/domain%20driven%20design.html)

---

## Conclusion

Following this collaboration guide ensures:
- **Consistent code quality** across the team
- **Standards compliance** through mandatory pre-work
- **Efficient development** with clear workflows
- **Knowledge sharing** via comprehensive documentation
- **Production-ready code** through quality gates

**Remember:** Read the standards before coding, follow the patterns, and run quality checks before submitting PRs.

---

**Questions?** Consult the [Standards Index](docs/standards/index.md) or [Application Design Guide](docs/systems/application-design.md).

**Happy Collaborating!** 🚀
