import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { LeaderboardRanking } from '../../api/types.js';
import { LIMITS, container, type Panel } from '../kit/index.js';
import { PAGES, PAGE_ROWS, boardPanels } from './leaderboard.js';

const entry = (i: number, games: number, first: number, wins = 0) => ({ discord_id: String(100000000000000000n + BigInt(i)), rating: 1700 - i, games_played: games, wins, first });
const ranking = (rows: ReturnType<typeof entry>[]): LeaderboardRanking => ({ rankings: rows, last_updated: 0 });
const view = (mode: string, rows: ReturnType<typeof entry>[]) =>
  ({ title: 'Civ6 Realtime FFA \u00b7 Lifetime', mode, ranking: ranking(rows), updated: new Date('2026-10-30T12:00:00Z') });
const textOf = (panel: Panel): string => JSON.stringify(container(panel).toJSON());

test('win% is 1st places over games, never the rating-gain counter', () => {
  const [first] = boardPanels(view('ffa', [entry(0, 21, 12, 19)]));
  const json = textOf(first!);
  assert.match(json, /`Rank` `Skill` `Games` ` 1st` `  Win%`/);
  assert.match(json, /`#1  ` ` 1700` `   21` `  12` ` 57.1%` \u2014 \u{1f947} <@100000000000000000> \u00b7 \*Emperor\*/u);
  assert.doesNotMatch(json, /` {2}19`/);
});

test('duel and teamer show won and lost; combined counts like FFA; no games is no division by zero', () => {
  assert.match(textOf(boardPanels(view('duel', [entry(0, 10, 7)]))[0]!), /` Won` `Lost`.*`   7` `   3` ` 70.0%`/);
  assert.match(textOf(boardPanels(view('teamer', [entry(0, 4, 4)]))[0]!), /`   4` `   0` `100.0%`/);
  assert.match(textOf(boardPanels(view('combined', [entry(0, 0, 0)]))[0]!), /`Games` ` 1st`.*`    0` `   0` `  0.0%`/);
});

test('a board is four panels of 25, titled first, keyed and stamped last, in short text blocks', () => {
  const rows = Array.from({ length: 100 }, (_, i) => entry(i, 999, 999));
  const panels = boardPanels(view('ffa', rows));
  assert.equal(panels.length, PAGES);
  assert.equal(panels[0]!.title, 'Civ6 Realtime FFA \u00b7 Lifetime');
  assert.equal(panels[1]!.title, undefined);
  for (const panel of panels) {
    const json = container(panel).toJSON() as { components: { content?: string }[] };
    const texts = json.components.map((c) => c.content ?? '');
    assert.ok(texts.reduce((n, t) => n + t.length, 0) <= LIMITS.text);
    // Discord cut the last row of a long block, so none grows past six lines.
    for (const t of texts) assert.ok(t.split('\n').length <= 6, t);
    assert.equal(texts.join('\n').match(/<@\d+>/g)?.length ?? 0, PAGE_ROWS);
  }
  assert.match(textOf(panels[1]!), new RegExp(`#${PAGE_ROWS + 1}`));
  assert.match(textOf(panels[3]!), /`#100`/);
  assert.match(textOf(panels[3]!), /Ranks: Deity 3\u2605 2400.*Scout"/);
  assert.match(textOf(panels[3]!), /Last updated <t:1793361600:f>/);
});

test('a short board takes only the panels it needs, and an empty one says so', () => {
  const panels = boardPanels(view('ffa', [entry(0, 1, 1)]));
  assert.equal(panels.length, 1);
  assert.match(textOf(panels[0]!), /<@100000000000000000>/);
  assert.match(textOf(panels[0]!), /Last updated/);
  assert.equal(boardPanels(view('ffa', Array.from({ length: 26 }, (_, i) => entry(i, 1, 1)))).length, 2);
  assert.equal(boardPanels(view('ffa', Array.from({ length: 140 }, (_, i) => entry(i, 1, 1)))).length, PAGES);
  assert.match(textOf(boardPanels(view('ffa', []))[0]!), /No rated games yet/);
});
