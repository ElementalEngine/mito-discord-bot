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

      // Keep lint low-friction. Warnings don't fail.
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

  // ---- Architecture boundaries (mite-v2-architecture.md §3) ----
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
        // The systemd entry shim is app's alias at the legacy path (R1 §2).
        { type: 'app', mode: 'full', pattern: 'src/index.ts' },
        // Catch-all LAST: everything else under src/ is the shrinking legacy zone.
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
            // R1 TRANSITIONAL: src/data/leaderboards-list.data.ts (frozen
            // contents) imports '../config.js' — a real pre-v2 edge. Allowed
            // until R3 relocates leaderboard config; R9 must re-tighten to
            // data → data only. Tracked in the rebuild plan risk table.
            { from: ['data'], allow: ['data', 'shared', 'core', 'legacy'] },
            // Legacy may keep its internal web + the shimmed core surfaces,
            // but never reaches into the new world. Shrinks per R3 batch;
            // flips to empty at R9.1.
            { from: ['legacy'], allow: ['legacy', 'core', 'data', 'shared'] },
          ],
        },
      ],
    },
  },

  // Repo-wide dependency bans (architecture drivers 2): Mite never touches
  // Mongo directly; axios is dead since v2.0.0.
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

  // Engine is pure: no runtime deps (architecture §3 hard rules).
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

  // Only core/api/http.ts may perform HTTP in the new zones (architecture §3).
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
