import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const eslintBin = require.resolve('eslint/bin/eslint.js');

const targets = [
  'src/engine/__lint_selftest__.ts',
  'src/features/lint_selftest_a',
  'src/features/lint_selftest_b',
];

const res = spawnSync(process.execPath, [eslintBin, '--no-ignore', ...targets], {
  encoding: 'utf8',
});
const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;

if (res.status === 0) {
  console.error('lint:selftest FAILED — boundary rules did not fire on known violations.');
  process.exit(1);
}
if (!/boundaries\/element-types|no-restricted-imports/.test(out)) {
  console.error('lint:selftest FAILED — eslint failed, but not on boundary rules:\n' + out);
  process.exit(1);
}
console.log('lint:selftest OK — boundary rules fire on known violations.');
