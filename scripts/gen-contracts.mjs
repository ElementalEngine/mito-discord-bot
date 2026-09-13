// Regenerates packages/contracts/src from the vendored OpenAPI spec.
// --check re-generates in memory and fails on any diff (D98, C12).
// Reads the VENDORED spec only: no network, no live core-api.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const spec = join(root, 'packages/contracts/openapi.json');
const out = join(root, 'packages/contracts/src/index.ts');
const check = process.argv.includes('--check');
const vendor = process.argv.includes('--vendor');
const CORE = '/opt/development/apps/core-api-backend';

// --vendor copies the spec and stamps PROVENANCE in one step, so the record
// can never name a SHA whose spec was not the one copied.
if (vendor) {
  if (!existsSync(CORE)) {
    console.error(`no core-api checkout at ${CORE}`);
    process.exit(1);
  }
  const dirty = execFileSync('git', ['-C', CORE, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
  if (dirty) {
    console.error(`core-api is not clean:\n${dirty}`);
    process.exit(1);
  }
  const sha = execFileSync('git', ['-C', CORE, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  copyFileSync(join(CORE, 'openapi.json'), spec);
  const paths = Object.keys(JSON.parse(readFileSync(spec, 'utf8')).paths).length;
  const note = readFileSync(join(root, 'packages/contracts/PROVENANCE'), 'utf8')
    .split('\n')
    .filter((line) => !/^source-(repo|sha|date):/.test(line))
    .join('\n')
    .replace(/^\n+/, '');
  writeFileSync(
    join(root, 'packages/contracts/PROVENANCE'),
    `source-repo: ElementalEngine/core-api-backend\nsource-sha: ${sha}\nsource-date: ${new Date().toISOString().slice(0, 10)}\n\n${note}`
  );
  console.log(`vendored ${sha}: ${paths} paths`);
}

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
