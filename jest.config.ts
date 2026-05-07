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
