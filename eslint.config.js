import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';

// TypeScript on the recommended rules, with formatting left to Prettier.
const KIT = 'Build messages with ui/kit and send them through ui/reply.ts.';
const KIT_ONLY = [
  "NewExpression[callee.name='EmbedBuilder']",
  "CallExpression[callee.property.name='setColor']",
  "MemberExpression[object.name='MessageFlags'][property.name='Ephemeral']",
  "Property[key.name='ephemeral']",
  'CallExpression[callee.property.name=/^(reply|editReply|followUp|deferReply|deferUpdate|deleteReply|update|send|edit)$/]',
].map((selector) => ({ selector, message: KIT }));

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.d.ts'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
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

      // Legacy code compatibility (don’t force a repo-wide refactor right now)
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
  // A promise is awaited, returned or marked void, so no failure goes unseen.
  {
    files: ['apps/bot/src/**/*.ts'],
    languageOptions: {
      parserOptions: { project: './apps/bot/tsconfig.json', tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': [
        'error',
        { allowForKnownSafeCalls: [{ from: 'package', name: ['test', 'describe', 'it'], package: 'node:test' }] },
      ],
    },
  },
  // Every Mite message is a ui/kit panel sent through ui/reply.ts.
  {
    files: ['apps/bot/src/**/*.ts'],
    ignores: ['apps/bot/src/ui/kit/**', 'apps/bot/src/ui/reply.ts', '**/*.test.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...KIT_ONLY],
    },
  },
];
