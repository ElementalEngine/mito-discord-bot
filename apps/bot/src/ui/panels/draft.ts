import { LabelBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';

import type { CivDataResponse, DraftDeal, DraftRequest } from '../../api/types.js';
import { LABEL_MAX, type PostAbout } from '../../utils/post-options.js';
import { customId, field, fit, mention, nameOf, plainNameOf, portraitOf, text, type CivNames, type Panel } from '../kit/index.js';
import { taggedFooter } from './misc.js';

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
export const LABEL_FIELD = 'label';

const MODE_CODES: Readonly<Record<Mode, string>> = { ffa: 'f', teamer: 't', duel: 'd' };
const AGE_CODES: Readonly<Record<Age, string>> = { AGE_ANTIQUITY: 'a', AGE_EXPLORATION: 'e', AGE_MODERN: 'm' };
const PACKED = /^([67])([ftd])([0-9a-z])([0-9a-z]{2})([0-9a-z]{2})([aemx])$/;
const two = (n: number): string => n.toString(36).padStart(2, '0');
const NONE = '-';
// A form holds five fields: up to four menus, then the label.
const MENUS_PER_FORM = 4;

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

export type DraftBans = Readonly<{ leaders: readonly string[]; civs: readonly string[] }>;

export function draftRequest(choice: DraftChoice, bans: DraftBans, hostId: string): DraftRequest {
  return {
    host_id: hostId,
    edition: choice.edition,
    game_type: choice.mode,
    drafts: choice.drafts,
    leaders: choice.leaders,
    civs: choice.civs,
    starting_age: choice.age,
    leader_bans: [...bans.leaders],
    civ_bans: [...bans.civs],
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

function labelField(label: string): LabelBuilder {
  const input = new TextInputBuilder().setCustomId(LABEL_FIELD).setStyle(TextInputStyle.Short).setMaxLength(LABEL_MAX).setRequired(false);
  if (label) input.setValue(label);
  return new LabelBuilder().setLabel('What it is for').setDescription('Optional. Shown in the title.').setTextInputComponent(input);
}

// The ban menus, leaders then civs; each may be left empty. The id carries the
// draft and who and where it is for; the label, too long for an id, is a field.
export function banForm(choice: DraftChoice, about: PostAbout, data: CivDataResponse, names: CivNames): ModalBuilder {
  const { leaders, civs } = banMenus(choice, data, names);
  if (leaders.length + civs.length > MENUS_PER_FORM) throw new Error('too many leaders and civs to ban in one form');
  return new ModalBuilder()
    .setCustomId(customId('draft', BAN_FORM, packChoice(choice), about.userId ?? NONE, about.channelId ?? NONE))
    .setTitle(fit(`Bans for your ${editionLabel(choice.edition)} ${MODES[choice.mode]} draft`, 45))
    .addLabelComponents(
      ...leaders.map((options, i) => menuLabel('leaders', options, leaders.length > 1).setStringSelectMenuComponent(menu(leaderField(i), options))),
      ...civs.map((options, i) => menuLabel('civs', options, civs.length > 1).setStringSelectMenuComponent(menu(civField(i), options))),
      labelField(about.label),
    );
}

export type BanFormAnswer = Readonly<{ choice: DraftChoice; about: PostAbout }>;

export function unpackForm(args: readonly string[], label: string): BanFormAnswer | null {
  const choice = unpackChoice(args[0] ?? '');
  if (!choice) return null;
  const idOf = (arg: string | undefined): string | null => (arg && arg !== NONE ? arg : null);
  return { choice, about: { label: label.trim(), userId: idOf(args[1]), channelId: idOf(args[2]) } };
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

export type DraftView = Readonly<{ choice: DraftChoice; deal: DraftDeal; names: CivNames; by: string; about: PostAbout }>;

// The draft as posted: one panel of what was asked and banned, then each
// draft as its own message, so a player can find and quote theirs.
export function draftPanels(view: DraftView): Panel[] {
  const { choice, deal, names, about } = view;
  const tagged = taggedFooter(about);
  const leaderBans = `Leaders: ${listOf(names, deal.bans.leader)}`;
  const bans = choice.edition === 'civ6' ? leaderBans : `${leaderBans}\nCivs: ${listOf(names, deal.bans.civ)}`;
  const head: Panel = {
    tone: 'info',
    surface: 'draft',
    title: about.label ? fit(`${draftTitle(choice)} for ${about.label}`, 200) : draftTitle(choice),
    subtitle: sizes(choice),
    body: [field('Bans', bans)],
    footer: `Drafted by ${mention(view.by)}${tagged ? ` \u00b7 ${tagged}` : ''}`,
  };
  const drafts = deal.pools.map(
    (pool, i): Panel => ({
      tone: 'info',
      title: draftLabel(choice.mode, i),
      body: [
        text(
          choice.edition === 'civ6'
            ? lines(names, pool.leaders)
            : `-# Leaders\n${lines(names, pool.leaders)}\n-# Civs\n${lines(names, pool.civs)}`,
        ),
      ],
    }),
  );
  return [head, ...drafts];
}
