import { defineConfig, globalIgnores } from 'eslint/config';
import stylistic from '@stylistic/eslint-plugin';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});
export default [
  globalIgnores(['**/eslint.config.mjs', '**/.commitlintrc.js', '**/migration/*.ts']),
  ...defineConfig({
    extends: compat.extends('plugin:jest/recommended', 'plugin:jest/style'),

    files: ['src/**/*.spec.ts', 'src/**/*.arch-spec.ts'],

    languageOptions: {
      globals: {
        ...globals.jest,
      },

      parser: tsParser,
      ecmaVersion: 2020,
      sourceType: 'module',

      parserOptions: {
        project: 'tsconfig.json',
      },
    },

    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  }),
  ...defineConfig([
    {
      extends: compat.extends('eslint:recommended', 'plugin:@typescript-eslint/recommended', 'plugin:prettier/recommended'),
      files: ['src/**/*.ts', 'src/**/*.js', 'src/**/*.mjs', 'src/**/*.cjs'],
      ignores: ['**/*.spec.ts', '**/*.arch-spec.ts', '**/migration/*.ts'],

      plugins: {
        '@stylistic': stylistic,
        '@typescript-eslint': typescriptEslint,
      },

      languageOptions: {
        globals: {
          ...globals.node,
          ...globals.jest,
        },

        parser: tsParser,
        ecmaVersion: 2020,
        sourceType: 'module',

        parserOptions: {
          project: 'tsconfig.json',
        },
      },

      rules: {
        'prettier/prettier': [
          'error',
          {
            endOfLine: 'auto',
          },
        ],

        eqeqeq: 'error',

        'max-len': [
          'error',
          {
            code: 150,
            tabWidth: 2,
            ignoreTemplateLiterals: true,
            ignoreStrings: true,
            ignoreUrls: true,
            ignoreRegExpLiterals: true,
          },
        ],

        'no-var': 'error',
        'no-await-in-loop': 'off',
        'no-console': 'error',
        'no-promise-executor-return': 'error',
        'no-template-curly-in-string': 'error',
        'no-useless-backreference': 'error',
        'require-atomic-updates': 'error',
        '@typescript-eslint/prefer-optional-chain': 'error',
        '@typescript-eslint/prefer-nullish-coalescing': 'off',
        '@typescript-eslint/no-confusing-non-null-assertion': 'error',
        '@typescript-eslint/prefer-for-of': 'error',
        '@typescript-eslint/no-unnecessary-type-constraint': 'error',
        'no-multiple-empty-lines': 'error',
        '@typescript-eslint/no-empty-object-type': 'off',

        'jest/valid-title': [
          0,
          {
            ignoreTypeOfDescribeName: true,
          },
        ],

        '@typescript-eslint/no-unused-vars': [
          'error',
          {
            argsIgnorePattern: '^_',
          },
        ],

        'prefer-rest-params': 'off',
      },
    },
  ]),
];
