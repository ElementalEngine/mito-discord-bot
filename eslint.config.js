import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Minimal, stable ESLint 9 flat config.
 * - Parses TypeScript
 * - Applies @typescript-eslint recommended rules
 * - Disables formatting rules via eslint-config-prettier
 *
 * Important: keep lint low-friction (no repo-wide refactors required).
 */
const KIT = 'Build messages with ui/kit and send them through ui/reply.ts.';
const KIT_ONLY = [
  "NewExpression[callee.name='EmbedBuilder']",
  "CallExpression[callee.property.name='setColor']",
  "MemberExpression[object.name='MessageFlags'][property.name='Ephemeral']",
  "Property[key.name='ephemeral']",
  'CallExpression[callee.property.name=/^(reply|editReply|followUp|deferReply|deferUpdate|deleteReply|update|send|edit)$/]',
].map((selector) => ({ selector, message: KIT }));

// Files not yet moved onto the kit. The list only shrinks.
const LEGACY_UI = [
  'apps/bot/src/commands/drafting/draft-civ6.ts',
  'apps/bot/src/commands/drafting/draft-civ7.ts',
  'apps/bot/src/commands/lobby/lobby.ts',
  'apps/bot/src/commands/misc/coinflip.ts',
  'apps/bot/src/commands/misc/get-users.ts',
  'apps/bot/src/commands/misc/mapseed.ts',
  'apps/bot/src/commands/misc/teamgen.ts',
  'apps/bot/src/commands/reporting/approve-report.ts',
  'apps/bot/src/commands/reporting/assign-discord-id-all.ts',
  'apps/bot/src/commands/reporting/assign-discord-id.ts',
  'apps/bot/src/commands/reporting/assign-order-teamer.ts',
  'apps/bot/src/commands/reporting/assign-order.ts',
  'apps/bot/src/commands/reporting/assign-sub.ts',
  'apps/bot/src/commands/reporting/contest-report.ts',
  'apps/bot/src/commands/reporting/remove-pending-match.ts',
  'apps/bot/src/commands/reporting/remove-sub.ts',
  'apps/bot/src/commands/reporting/report-game.ts',
  'apps/bot/src/commands/reporting/revert-report.ts',
  'apps/bot/src/commands/reporting/trigger-quit.ts',
  'apps/bot/src/commands/stats/resetstats.ts',
  'apps/bot/src/commands/stats/roomranking.ts',
  'apps/bot/src/commands/stats/stats.ts',
  'apps/bot/src/commands/voting/secretvote.ts',
  'apps/bot/src/interactions/secretvote.interactions.ts',
  'apps/bot/src/jobs/post-finished-lobbies.ts',
  'apps/bot/src/jobs/update-leaderboard.ts',
  'apps/bot/src/services/drafting/orchestration.service.ts',
  'apps/bot/src/services/secretvote/runtime/message-ops.service.ts',
  'apps/bot/src/ui/embeds/lobby.ts',
  'apps/bot/src/ui/embeds/reporting.ts',
  'apps/bot/src/ui/embeds/secretvote.ts',
  'apps/bot/src/ui/embeds/standard-draft.ts',
  'apps/bot/src/ui/embeds/stats.ts',
  'apps/bot/src/utils/log-command.ts',
];

export default [
  {
    files: ['apps/activity/src/client/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
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
  // Every Mite message is a ui/kit panel sent through ui/reply.ts.
  {
    files: ['apps/bot/src/**/*.ts'],
    ignores: ['apps/bot/src/ui/kit/**', 'apps/bot/src/ui/reply.ts', '**/*.test.ts', ...LEGACY_UI],
    rules: {
      'no-restricted-syntax': ['error', ...KIT_ONLY],
    },
  },
];
