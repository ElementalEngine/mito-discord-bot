import { LabelBuilder, ModalBuilder, StringSelectMenuBuilder } from 'discord.js';

import type { CivDataResponse, DealRequest, DealResponse } from '../../api/types.js';
import { customId, field, fit, mention, nameOf, plainNameOf, portraitOf, text, LIMITS, type CivNames, type Panel } from '../kit/index.js';

export type Edition = 'civ6' | 'civ7';
export type Mode = 'ffa' | 'teamer' | 'duel';
export type Age = 'AGE_ANTIQUITY' | 'AGE_EXPLORATION' | 'AGE_MODERN';

// What the host chose. `leaders` and `civs` are per draft; civ6 deals leaders
// only, and a civ7 age of null is every age.
export type DraftChoice = Readonly<{
  edition: Edition;
  mode: Mode;
  drafts: number;
  leaders: number;
  civs: number | null;
  age: Age | null;
}>;

export const MODES: Readonly<Record<Mode, string>> = { ffa: 'FFA', teamer: 'Teamer', duel: 'Duel' };
export const AGES: Readonly<Record<Age, string>> = { AGE_ANTIQUITY: 'Antiquity', AGE_EXPLORATION: 'Exploration', AGE_MODERN: 'Modern' };
export const BAN_FORM = 'bans';

const MODE_CODES: Readonly<Record<Mode, string>> = { ffa: 'f', teamer: 't', duel: 'd' };
const AGE_CODES: Readonly<Record<Age, string>> = { AGE_ANTIQUITY: 'a', AGE_EXPLORATION: 'e', AGE_MODERN: 'm' };
const PACKED = /^([67])([ftd])([0-9a-z])([0-9a-z]{2})([0-9a-z]{2})([aemx])$/;
const two = (n: number): string => n.toString(36).padStart(2, '0');

// The choice as one id part, so a form still knows it after a restart.
export function packChoice(choice: DraftChoice): string {
  const age = choice.age ? AGE_CODES[choice.age] : 'x';
  const edition = choice.edition === 'civ6' ? '6' : '7';
  return `${edition}${MODE_CODES[choice.mode]}${choice.drafts.toString(36)}${two(choice.leaders)}${two(choice.civs ?? 0)}${age}`;
}

export function unpackChoice(packed: string): DraftChoice | null {
  const m = PACKED.exec(packed);
  if (!m) return null;
  const edition: Edition = m[1] === '6' ? 'civ6' : 'civ7';
  const mode = (Object.keys(MODE_CODES) as Mode[]).find((k) => MODE_CODES[k] === m[2])!;
  const age = (Object.keys(AGE_CODES) as Age[]).find((k) => AGE_CODES[k] === m[6]) ?? null;
  return {
    edition,
    mode,
    drafts: parseInt(m[3]!, 36),
    leaders: parseInt(m[4]!, 36),
    civs: edition === 'civ7' ? parseInt(m[5]!, 36) : null,
    age: edition === 'civ7' ? age : null,
  };
}

export function dealRequest(choice: DraftChoice, leaderBans: readonly string[], civBans: readonly string[]): DealRequest {
  return {
    edition: choice.edition,
    game_type: choice.mode,
    drafts: choice.drafts,
    leaders: choice.leaders,
    civs: choice.civs,
    starting_age: choice.age,
    leader_bans: [...leaderBans],
    civ_bans: [...civBans],
  };
}

type Option = Readonly<{ token: string; label: string; emoji: { id: string; name: string } | undefined }>;

const sortedOptions = (tokens: readonly string[], names: CivNames): Option[] =>
  tokens
    .map((token) => ({ token, label: plainNameOf(names, token), emoji: portraitOf(names, token) }))
    .sort((a, b) => a.label.localeCompare(b.label));

function inMenus(options: readonly Option[]): Option[][] {
  const out: Option[][] = [];
  for (let i = 0; i < options.length; i += 25) out.push(options.slice(i, i + 25));
  return out;
}

// The form's menus: leaders, then civs for the chosen age, 25 to a menu.
export function banMenus(choice: DraftChoice, data: CivDataResponse, names: CivNames): Readonly<{ leaders: Option[][]; civs: Option[][] }> {
  const civs = choice.edition === 'civ7' ? data.civs.filter((c) => !choice.age || c.age_pool === choice.age).map((c) => c.token) : [];
  return { leaders: inMenus(sortedOptions(data.leaders.map((l) => l.token), names)), civs: inMenus(sortedOptions(civs, names)) };
}

export const leaderField = (i: number): string => `l${i + 1}`;
export const civField = (i: number): string => `c${i + 1}`;

function menuLabel(kind: string, menu: readonly Option[], many: boolean): LabelBuilder {
  const range = many ? ` ${menu[0]!.label[0]}–${menu[menu.length - 1]!.label[0]}` : '';
  return new LabelBuilder().setLabel(fit(`Ban ${kind}${range}`, 45)).setDescription('Optional. Pick any number.');
}

function menu(id: string, options: readonly Option[]): StringSelectMenuBuilder {
  return new StringSelectMenuBuilder()
    .setCustomId(id)
    .setMinValues(0)
    .setMaxValues(options.length)
    .setRequired(false)
    .setPlaceholder('Nothing banned')
    .addOptions(options.map((o) => ({ label: fit(o.label, 100), value: o.token, ...(o.emoji ? { emoji: o.emoji } : {}) })));
}

// The ban menus, leaders then civs; each may be left empty.
export function banForm(choice: DraftChoice, packed: string, data: CivDataResponse, names: CivNames): ModalBuilder {
  const { leaders, civs } = banMenus(choice, data, names);
  if (leaders.length + civs.length > 5) throw new Error('too many leaders and civs to ban in one form');
  return new ModalBuilder()
    .setCustomId(customId('draft', BAN_FORM, packed))
    .setTitle(fit(`Bans for your ${editionLabel(choice.edition)} ${MODES[choice.mode]} draft`, 45))
    .addLabelComponents(
      ...leaders.map((options, i) => menuLabel('leaders', options, leaders.length > 1).setStringSelectMenuComponent(menu(leaderField(i), options))),
      ...civs.map((options, i) => menuLabel('civs', options, civs.length > 1).setStringSelectMenuComponent(menu(civField(i), options))),
    );
}

const editionLabel = (edition: Edition): string => (edition === 'civ6' ? 'Civ6' : 'Civ7');

export const draftTitle = (choice: DraftChoice): string => `${editionLabel(choice.edition)} ${MODES[choice.mode]} draft`;

function sizes(choice: DraftChoice): string {
  if (choice.edition === 'civ6') return `${choice.drafts} drafts \u00b7 ${choice.leaders} civs each`;
  const age = choice.age ? AGES[choice.age] : 'Every age';
  return `${choice.drafts} drafts \u00b7 ${choice.leaders} leaders and ${choice.civs} civs each \u00b7 ${age}`;
}

const listOf = (names: CivNames, tokens: readonly string[]): string => (tokens.length ? tokens.map((t) => nameOf(names, t)).join(' \u00b7 ') : 'None');

// One pick a line, so a player can quote the ones they trade.
const lines = (names: CivNames, tokens: readonly string[]): string => tokens.map((t) => nameOf(names, t)).join('\n');

// A teamer deals one draft per team; every other mode one per player.
export const draftLabel = (mode: Mode, i: number): string => (mode === 'teamer' ? `Team ${i + 1}` : `Player n\u00b0${i + 1}`);

export type DraftView = Readonly<{ choice: DraftChoice; deal: DealResponse; names: CivNames; by: string }>;

// Room left in a panel for its heading, subtitle and footer.
const PAGE_TEXT = LIMITS.text - 300;
const PAGE_DRAFTS = 30;

// The draft as posted: the bans, then each draft in order. A long draft runs
// on into more panels; the last says who drafted it.
export function draftPanels(view: DraftView): Panel[] {
  const { choice, deal, names } = view;
  const leaderBans = `Leaders: ${listOf(names, deal.bans.leader)}`;
  const bans = choice.edition === 'civ6' ? leaderBans : `${leaderBans}\nCivs: ${listOf(names, deal.bans.civ)}`;
  const drafts = deal.pools.map((pool, i) => {
    const label = `**${draftLabel(choice.mode, i)}**`;
    if (choice.edition === 'civ6') return `${label}\n${lines(names, pool.leaders)}`;
    return `${label}\n-# Leaders\n${lines(names, pool.leaders)}\n-# Civs\n${lines(names, pool.civs)}`;
  });
  const pages: string[][] = [[]];
  let used = bans.length;
  for (const draft of drafts) {
    const page = pages[pages.length - 1]!;
    if (page.length && (used + draft.length > PAGE_TEXT || page.length >= PAGE_DRAFTS)) {
      pages.push([]);
      used = 0;
    }
    pages[pages.length - 1]!.push(draft);
    used += draft.length;
  }
  const title = draftTitle(choice);
  return pages.map((page, i) => ({
    tone: 'info',
    surface: 'draft',
    title: i === 0 ? title : `${title}, continued`,
    ...(i === 0 ? { subtitle: sizes(choice) } : {}),
    body: [...(i === 0 ? [field('Bans', bans)] : []), ...page.map(text)],
    ...(i === pages.length - 1 ? { footer: `Drafted by ${mention(view.by)}` } : {}),
  }));
}
