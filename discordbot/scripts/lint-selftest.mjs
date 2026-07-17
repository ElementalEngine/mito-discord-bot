import { loadESLint } from 'eslint';

const targets = [
  'src/engine/__lint_selftest__.ts',
  'src/features/lint_selftest_a/index.ts',
  'src/features/lint_selftest_b/index.ts',
];

const ESLint = await loadESLint();
const eslint = new ESLint({ ignore: false }); // fixtures are ignored in normal lint
const results = await eslint.lintFiles(targets);

const ruleIds = new Set(
  results.flatMap((r) => r.messages.map((m) => m.ruleId).filter(Boolean))
);
const errorCount = results.reduce((n, r) => n + r.errorCount, 0);

const expected =
  ruleIds.has('boundaries/element-types') || ruleIds.has('no-restricted-imports');

if (errorCount === 0 || !expected) {
  console.error(
    'lint:selftest FAILED — boundary rules did not fire on known violations.',
    { errorCount, ruleIds: [...ruleIds] }
  );
  process.exit(1);
}
console.log('lint:selftest OK — boundary rules fire on known violations.');