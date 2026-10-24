import assert from 'node:assert/strict';
import test from 'node:test';

import { parseId } from '../kit/index.js';
import { collectionName, labelFromId, seasonCancelledPanel, seasonPreviewPanel, seasonStartedPanel } from './season.js';

const preview = {
  edition: 'civ6',
  label: 'Season 6',
  next_label: 'Season 7',
  started_at: '2026-08-25T00:00:00Z',
  records: { rt_ffa: 1645, rt_teamer: 38, pbc_duel: 0 },
};

test('the preview says what changes, and its buttons carry the season shown', () => {
  const panel = seasonPreviewPanel(preview);
  const body = JSON.stringify(panel.body);
  assert.equal(panel.subtitle, 'Civ6 \u00b7 Season 6 \u2192 Season 7');
  assert.match(body, /Realtime FFA: 1,645\\nRealtime Teamer: 38/);
  assert.doesNotMatch(body, /Cloud Duel/);
  const ids = panel.actions?.[0]?.components.map((b) => (b.toJSON() as { custom_id: string }).custom_id) ?? [];
  assert.deepEqual(ids, ['season:start:civ6:Season_6', 'season:cancel:civ6:Season_6']);
  assert.equal(labelFromId(parseId(ids[0] ?? '')?.args[1] ?? ''), 'Season 6');
});

test('collections read as players say them', () => {
  assert.equal(collectionName('pbc_teamer'), 'Cloud Teamer');
  assert.equal(collectionName('rt_combined'), 'Realtime combined');
});

test('a started season names the backup; a cancelled one says nothing changed', () => {
  const panel = seasonStartedPanel({
    edition: 'civ6',
    closed: 'Season 6',
    opened: 'Season 7',
    started_at: '2026-10-24T12:00:00Z',
    backup: 'civ6-season-6-20261024T120000Z',
    records: { rt_ffa: 1645, rt_teamer: 38 },
  });
  assert.equal(panel.tone, 'success');
  assert.match(JSON.stringify(panel.body), /Season 6's 1,683 season records were saved, then cleared/);
  assert.equal(panel.footer, 'Backup: civ6-season-6-20261024T120000Z');
  assert.equal(seasonCancelledPanel().tone, 'muted');
});
