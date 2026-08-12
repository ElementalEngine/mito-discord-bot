import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkManifests, loadManifests } from './version-pins.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const cases = [
  {
    name: 'a caret range on a fleet dep is rejected',
    manifests: [
      { path: 'a', json: { engines: { node: '>=24.18.0' }, dependencies: { 'discord.js': '^14.25.1' } } },
    ],
    expect: /discord\.js.*exact pin/,
  },
  {
    name: 'an exact pin on a fleet dep is accepted',
    manifests: [
      { path: 'a', json: { engines: { node: '>=24.18.0' }, dependencies: { 'discord.js': '14.27.0' } } },
    ],
    expect: null,
  },
  {
    name: 'a caret on a NON-fleet dep is ignored',
    manifests: [
      { path: 'a', json: { engines: { node: '>=24.18.0' }, devDependencies: { typescript: '^5.9.3' } } },
    ],
    expect: null,
  },
  {
    name: 'mismatched engines.node is rejected',
    manifests: [
      { path: 'a', json: { engines: { node: '>=24.18.0' } } },
      { path: 'b', json: { engines: { node: '>=24.12.0' } } },
    ],
    expect: /engines\.node differs/,
  },
  {
    name: 'a missing engines.node is rejected',
    manifests: [{ path: 'a', json: {} }],
    expect: /no engines\.node/,
  },
  {
    name: 'an unpinned override is rejected',
    manifests: [
      { path: 'a', json: { engines: { node: '>=24.18.0' }, overrides: { undici: '^6.27.0' } } },
    ],
    expect: /undici.*exact pin/,
  },
];

for (const c of cases) {
  test(c.name, () => {
    const problems = checkManifests(c.manifests);
    if (c.expect === null) assert.deepEqual(problems, []);
    else assert.match(problems.join('\n'), c.expect);
  });
}

test('this repo passes its own check', () => {
  assert.deepEqual(checkManifests(loadManifests(root)), []);
});
