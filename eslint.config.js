import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';
import boundaries from 'eslint-plugin-boundaries';

/**
 * ESLint 9 flat config.
 */
export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '**/*.d.ts',
      'src/engine/__lint_selftest__.ts',
      'src/features/lint_selftest_a/**',
      'src/features/lint_selftest_b/**',
    ],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...prettier.rules,
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'data', mode: 'full', pattern: 'src/data/**/*' },
        { type: 'shared', mode: 'full', pattern: 'src/shared/**/*' },
        { type: 'engine', mode: 'full', pattern: 'src/engine/**/*' },
        { type: 'core', mode: 'full', pattern: 'src/core/**/*' },
        { type: 'session', mode: 'full', pattern: 'src/session/**/*' },
        {
          type: 'features',
          mode: 'full',
          pattern: 'src/features/*/**/*',
          capture: ['slice'],
        },
        { type: 'activity', mode: 'full', pattern: 'src/activity/**/*' },
        { type: 'app', mode: 'full', pattern: 'src/app/**/*' },
        { type: 'app', mode: 'full', pattern: 'src/index.ts' },
        { type: 'legacy', mode: 'full', pattern: 'src/**/*' },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          message:
            'Architecture boundary violation (${file.type} → ${dependency.type}) — see mite-v2-architecture.md §3',
          rules: [
            { from: ['engine'], allow: ['data', 'shared', 'engine'] },
            { from: ['shared'], allow: ['shared', 'data'] },
            { from: ['core'], allow: ['shared', 'core'] },
            {
              from: ['session'],
              allow: ['data', 'shared', 'engine', 'core', 'session'],
            },
            {
              from: ['features'],
              allow: [
                'data',
                'shared',
                'engine',
                'core',
                'session',
                ['features', { slice: '${from.slice}' }],
              ],
            },
            {
              from: ['activity'],
              allow: ['data', 'shared', 'engine', 'core', 'session', 'activity'],
            },
            {
              from: ['app'],
              allow: [
                'data',
                'shared',
                'engine',
                'core',
                'session',
                'features',
                'activity',
                'app',
                'legacy',
              ],
            },
            { from: ['data'], allow: ['data'] },
            { from: ['legacy'], allow: ['legacy', 'core', 'data', 'shared'] },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'mongodb', message: 'Mite never touches Mongo — all persistence via core-api (architecture driver 2).' },
            { name: 'mongoose', message: 'Mite never touches Mongo — all persistence via core-api (architecture driver 2).' },
            { name: 'axios', message: 'axios is dead in v2 — core/api/http.ts owns transport.' },
          ],
        },
      ],
    },
  },
  {
    files: [
      'src/app/**/*.ts',
      'src/core/**/*.ts',
      'src/engine/**/*.ts',
      'src/features/**/*.ts',
      'src/session/**/*.ts',
      'src/activity/**/*.ts',
      'src/shared/**/*.ts',
    ],
    rules: {
      'no-console': 'error',
    },
  },
  {
    files: ['src/core/logging.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['src/engine/**/*.ts', 'src/shared/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
    },
  },
  {
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'discord.js', message: 'engine/ is pure — no discord.js (architecture §3).' },
            { name: 'express', message: 'engine/ is pure — no express (architecture §3).' },
            { name: 'mongodb', message: 'Mite never touches Mongo.' },
            { name: 'mongoose', message: 'Mite never touches Mongo.' },
            { name: 'axios', message: 'axios is dead in v2.' },
          ],
          patterns: [
            { group: ['discord.js/*', 'express/*'], message: 'engine/ is pure (architecture §3).' },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'engine/ is pure — no I/O (architecture §3).' },
      ],
    },
  },
  {
    files: [
      'src/app/**/*.ts',
      'src/core/**/*.ts',
      'src/session/**/*.ts',
      'src/activity/**/*.ts',
      'src/features/**/*.ts',
      'src/shared/**/*.ts',
    ],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Only core/api/http.ts calls fetch (architecture §3).' },
      ],
    },
  },
  {
    files: ['src/core/api/http.ts'],
    rules: {
      'no-restricted-globals': 'off',
    },
  },
];
