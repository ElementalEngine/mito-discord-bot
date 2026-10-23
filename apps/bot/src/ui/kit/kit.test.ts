import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, type APIContainerComponent } from 'discord.js';

import {
  LIMITS,
  TONES,
  aside,
  blocksOf,
  chunk,
  componentCount,
  container,
  customId,
  divider,
  fit,
  notice,
  parseId,
  pretty,
  row,
  signed,
  text,
  when,
  withinTextLimit,
} from './index.js';

/**
 * The kit every Mite message is built from. What should break this file: a
 * message Discord would reject (over 40 components or 4000 characters), a
 * panel whose bar does not carry its tone, or an id a restart cannot parse.
 */

const json = (panel: Parameters<typeof container>[0]): APIContainerComponent => container(panel).toJSON();

test('fit cuts with an ellipsis and leaves short text alone', () => {
  assert.equal(fit('abcdef', 4), 'abc\u2026');
  assert.equal(fit('abc', 4), 'abc');
  assert.equal(fit('abc', 0), '');
});

test('chunk splits on lines and never exceeds the limit', () => {
  const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
  const parts = chunk(lines, 40);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 40));
  assert.equal(parts.join('\n'), lines);
});

test('a custom id round-trips and refuses what would break parsing', () => {
  const id = customId('lobby', 'open', '652f1a2b3c4d5e6f7a8b9c0d');
  assert.equal(id, 'lobby:open:652f1a2b3c4d5e6f7a8b9c0d');
  assert.deepEqual(parseId(id), { surface: 'lobby', verb: 'open', args: ['652f1a2b3c4d5e6f7a8b9c0d'] });
  assert.throws(() => customId('report', 'set:order'));
  assert.throws(() => customId('report', 'x', 'a'.repeat(LIMITS.customId)));
  assert.equal(parseId('lobby'), null);
});

test('formatters', () => {
  assert.equal(signed(12.4), '+12');
  assert.equal(signed(-3.6), '\u22124');
  assert.equal(signed(0.2), '\u00b10');
  assert.equal(when(1_700_000_000_000, 'R'), '<t:1700000000:R>');
  assert.equal(pretty('LEADER_CATHERINE_DE_MEDICI'), 'Catherine De Medici');
});

test('the palette is the Activity\u2019s, so the bot and the Activity match', () => {
  const css = readFileSync(new URL('../../../../activity/src/client/index.css', import.meta.url), 'utf8');
  const colour = (name: string): number => {
    const hex = new RegExp(`--color-${name}:\\s*#([0-9a-fA-F]{6})`).exec(css)?.[1];
    assert.ok(hex, `--color-${name} not found in the Activity theme`);
    return Number.parseInt(hex, 16);
  };
  assert.equal(TONES.info.colour, colour('accent'));
  assert.equal(TONES.success.colour, colour('good'));
  assert.equal(TONES.failed.colour, colour('danger'));
  assert.equal(TONES.muted.colour, colour('muted'));
});

test('the bar carries the tone, and an accent overrides it', () => {
  assert.equal(json({ tone: 'success', title: 'Done' }).accent_color, TONES.success.colour);
  assert.equal(json({ tone: 'info', title: 'Rank', accent: 0x123456 }).accent_color, 0x123456);
});

test('a titled panel opens with its heading, surface mark and subtitle', () => {
  const blocks = blocksOf({ tone: 'info', surface: 'lobby', title: 'Lobby open', subtitle: 'civ6 \u00b7 FFA', body: [text('x')] });
  const head = blocks[0];
  assert.ok(head?.kind === 'text');
  assert.match(head.text, /^## \S+ Lobby open\n-# civ6 \u00b7 FFA$/);
  assert.equal(blocks[1]?.kind, 'divider');
});

test('a notice is one line with the tone emoji', () => {
  const c = json(notice('refused', 'Not your lobby.'));
  assert.equal(c.components.length, 1);
  const only = c.components[0];
  assert.ok(only?.type === ComponentType.TextDisplay);
  assert.equal(only.content, `${TONES.refused.emoji} Not your lobby.`);
});

test('text over Discord\u2019s total is trimmed from the longest block', () => {
  const blocks = withinTextLimit([text('a'.repeat(3000)), text('b'.repeat(3000))], 4000);
  const total = blocks.reduce((n, b) => n + ('text' in b ? b.text.length : 0), 0);
  assert.ok(total <= 4000);
});

test('a panel over 40 components is refused before Discord sees it', () => {
  const button = () => new ButtonBuilder().setCustomId(customId('t', 'x')).setLabel('x').setStyle(ButtonStyle.Secondary);
  const body = Array.from({ length: 14 }, () => aside('row', button()));
  assert.equal(componentCount(body), 1 + 14 * 3);
  assert.throws(() => container({ tone: 'info', body }), /components/);
  assert.doesNotThrow(() => container({ tone: 'info', body: body.slice(0, 13) }));
});

test('a divider renders as a separator', () => {
  const c = json({ tone: 'muted', body: [text('a'), divider(true), text('b')] });
  assert.deepEqual(
    c.components.map((x) => x.type),
    [ComponentType.TextDisplay, ComponentType.Separator, ComponentType.TextDisplay],
  );
});

test('a row of buttons sits among the blocks, where it is placed, and counts its buttons', () => {
  const button = new ButtonBuilder().setCustomId(customId('t', 'x')).setLabel('x').setStyle(ButtonStyle.Secondary);
  const body = [text('a'), row(new ActionRowBuilder<ButtonBuilder>().addComponents(button)), text('b')];
  assert.equal(componentCount(body), 1 + 1 + 2 + 1);
  assert.deepEqual(
    json({ tone: 'info', body }).components.map((x) => x.type),
    [ComponentType.TextDisplay, ComponentType.ActionRow, ComponentType.TextDisplay],
  );
});
