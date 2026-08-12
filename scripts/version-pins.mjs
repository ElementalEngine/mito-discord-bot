// D12 fleet version alignment, enforced across this repo's manifests.
// Auth and LJ are Wave 2 (D40) and are NOT checked here: they are frozen,
// so a check spanning them would go red on repos Wave 1 may not touch,
// and reading them would need the cross-repo plumbing D98 rejects.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Deps where three copies drifting apart is itself the bug (D12, D58).
export const FLEET_DEPS = ['discord.js', '@discordjs/rest', 'undici'];

export const MANIFESTS = [
  'package.json',
  'apps/bot/package.json',
  'packages/contracts/package.json',
];

const EXACT = /^\d+\.\d+\.\d+$/;

export function checkManifests(manifests) {
  const problems = [];
  const nodeEngines = new Map();

  for (const { path, json } of manifests) {
    const engine = json.engines?.node;
    if (!engine) problems.push(`${path}: no engines.node`);
    else nodeEngines.set(path, engine);

    for (const field of ['dependencies', 'devDependencies', 'overrides']) {
      for (const [name, range] of Object.entries(json[field] ?? {})) {
        if (FLEET_DEPS.includes(name) && !EXACT.test(range)) {
          problems.push(`${path}: ${name} is "${range}", must be an exact pin`);
        }
      }
    }
  }

  const distinct = new Set(nodeEngines.values());
  if (distinct.size > 1) {
    const shown = [...nodeEngines].map(([p, e]) => `${p}="${e}"`).join(', ');
    problems.push(`engines.node differs across manifests: ${shown}`);
  }

  return problems;
}

export function loadManifests(root) {
  return MANIFESTS.map((path) => ({
    path,
    json: JSON.parse(readFileSync(join(root, path), 'utf8')),
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const problems = checkManifests(loadManifests(root));
  if (problems.length) {
    console.error('D12 version-pin check failed:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`D12 version-pin check passed (${MANIFESTS.length} manifests)`);
}
