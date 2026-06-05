import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../report/coverage',
  testEnvironment: 'node',
  moduleDirectories: ['node_modules'],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/$1',
    // Story 13.10: `deepagents` + `@langchain/openai` transitively import
    // ESM-only modules (`is-network-error` via `p-retry`) that Jest's CJS
    // env can't parse. Map them to lightweight stubs for unit tests; the
    // real packages are exercised in e2e + byte-equivalence specs only.
    '^deepagents$': '<rootDir>/../test/mocks/deepagents.mock.ts',
    '^@langchain/openai$': '<rootDir>/../test/mocks/langchain-openai.mock.ts',
  },
  coveragePathIgnorePatterns: [
    '<rootDir>/shared/postgres/migration/',
    '<rootDir>/dist/',
    '<rootDir>/node_modules/',
    '<rootDir>/shared/mongo/',
    '<rootDir>/shared/postgres/',
    '<rootDir>/shared/health/',
    '<rootDir>/shared/logger/',
    '<rootDir>/utils/',
    '.entity.ts',
    '.module.ts',
    '.dto.ts',
    '.config.ts',
    '.validation.ts',
    'index.ts',
  ],
  coverageThreshold: {
    global: {
      lines: 50,
    },
  },
};

export default config;
