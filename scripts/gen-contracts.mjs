// Regenerates packages/contracts/src from the vendored OpenAPI spec.
// --check re-generates in memory and fails on any diff (D98, C12).
// Reads the VENDORED spec only: no network, no live core-api.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const spec = join(root, 'packages/contracts/openapi.json');
const out = join(root, 'packages/contracts/src/index.ts');
const check = process.argv.includes('--check');

const banner = [
  '// GENERATED - DO NOT EDIT.',
  '// Regenerate with: npm run gen:contracts',
  '// Source: packages/contracts/openapi.json (see PROVENANCE)',
  '',
].join('\n');

const generated =
  banner +
  execFileSync('npx', ['openapi-typescript', spec], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

if (!check) {
  writeFileSync(out, generated);
  console.log(`wrote ${out}`);
} else {
  const current = readFileSync(out, 'utf8');
  if (current !== generated) {
    console.error(
      'contracts are stale: generated output differs from the committed file.\n' +
        'Run `npm run gen:contracts` and commit the result.'
    );
    process.exit(1);
  }
  console.log('contracts up to date');
}
