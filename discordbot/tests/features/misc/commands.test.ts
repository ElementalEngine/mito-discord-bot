import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as coinflip from '../../../src/features/misc/commands/coinflip.js';
import * as getUsers from '../../../src/features/misc/commands/get-users.js';
import * as mapseed from '../../../src/features/misc/commands/mapseed.js';
import * as teamgen from '../../../src/features/misc/commands/teamgen.js';

type OptionJson = Readonly<{ name: string; required?: boolean }>;

const modules = [coinflip, getUsers, mapseed, teamgen];

test('every misc command exposes the loader contract (data.name + execute)', () => {
  for (const mod of modules) {
    assert.equal(typeof mod.execute, 'function');
    assert.equal(typeof mod.data.name, 'string');
  }
});

test('misc slash command names are unchanged by the port', () => {
  assert.deepEqual(
    modules.map((m) => m.data.name).sort(),
    ['coinflip', 'get-users', 'mapseed', 'teamgen']
  );
});

test('teamgen option schema is unchanged by the port', () => {
  const json = teamgen.data.toJSON() as unknown as { options?: OptionJson[] };
  const options = json.options ?? [];

  assert.deepEqual(
    options.map((o) => [o.name, o.required === true]),
    [
      ['version', true],
      ['discord-ids', false],
    ]
  );
});

test('mapseed option schema is unchanged by the port', () => {
  const json = mapseed.data.toJSON() as unknown as { options?: OptionJson[] };
  const options = json.options ?? [];

  assert.deepEqual(
    options.map((o) => [o.name, o.required === true]),
    [
      ['for', false],
      ['tag', false],
      ['where', false],
    ]
  );
});
