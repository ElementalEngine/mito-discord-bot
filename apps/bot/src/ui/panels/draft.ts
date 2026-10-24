import { LabelBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';

import type { CivDataResponse, DealRequest, DealResponse, DraftQuestion } from '../../api/types.js';
import { customId, field, fit, mention, nameOf, plainNameOf, portraitOf, text, LIMITS, type Block, type CivNames, type Panel } from '../kit/index.js';

export type Edition = 'civ6' | 'civ7';
export type Mode = 'ffa' | 'teamer' | 'duel';
export type Age = 'AGE_ANTIQUITY' | 'AGE_EXPLORATION' | 'AGE_MODERN';
export type DraftSettings = Readonly<Record<Edition, readonly DraftQuestion[]>>;

// What the host chose, apart from the free-text rules. `leaders` and `civs`
// are per draft; civ6 deals leaders only, and a civ7 age of null is every age.
export type DraftChoice = Readonly<{
  edition: Edition;
  mode: Mode;
  drafts: number;
  leaders: number;
  civs: number | null;
  age: Age | null;
  settings: Readonly<Record<string, string>>;
}>;

export const MODES: Readonly<Record<Mode, string>> = { ffa: 'FFA', teamer: 'Teamer', duel: 'Duel' };
export const AGES: Readonly<Record<Age, string>> = { AGE_ANTIQUITY: 'Antiquity', AGE_EXPLORATION: 'Exploration', AGE_MODERN: 'Modern' };
export const BAN_FORM = 'bans';
export const RULES_FIELD = 'rules';

const MODE_CODES: Readonly<Record<Mode, string>> = { ffa: 'f', teamer: 't', duel: 'd' };
const AGE_CODES: Readonly<Record<Age, string>> = { AGE_ANTIQUITY: 'a', AGE_EXPLORATION: 'e', AGE_MODERN: 'm' };
const PACKED = /^([67])([ftd])([0-9a-z])([0-9a-z]{2})([0-9a-z]{2})([aemx])([0-9a-z]*)$/;
const two = (n: number): string => n.toString(36).padStart(2, '0');

// The choice as one id part, so a form still knows it after a restart. Each
// setting is its option's place in the question, 0 when left to the host.
export function packChoice(choice: DraftChoice, questions: readonly DraftQuestion[]): string {
  const settings = questions
    .map((q) => (q.options.findIndex((o) => o.id === choice.settings[q.id]) + 1).toString(36))
    .join('');
  const age = choice.age ? AGE_CODES[choice.age] : 'x';
  const edition = choice.edition === 'civ6' ? '6' : '7';
  return `${edition}${MODE_CODES[choice.mode]}${choice.drafts.toString(36)}${two(choice.leaders)}${two(choice.civs ?? 0)}${age}${settings}`;
}

export function unpackChoice(packed: string, settings: DraftSettings | null): DraftChoice | null {
  const m = PACKED.exec(packed);
  if (!m) return null;
  const edition: Edition = m[1] === '6' ? 'civ6' : 'civ7';
  const mode = (Object.keys(MODE_CODES) as Mode[]).find((k) => MODE_CODES[k] === m[2])!;
  const age = (Object.keys(AGE_CODES) as Age[]).find((k) => AGE_CODES[k] === m[6]) ?? null;
  const questions = settings?.[edition] ?? [];
  const chosen: Record<string, string> = {};
  [...m[7]!].forEach((code, i) => {
    const option = questions[i]?.options[parseInt(code, 36) - 1];
    if (option) chosen[questions[i]!.id] = option.id;
  });
  return {
    edition,
    mode,
    drafts: parseInt(m[3]!, 36),
    leaders: parseInt(m[4]!, 36),
    civs: edition === 'civ7' ? parseInt(m[5]!, 36) : null,
    age: edition === 'civ7' ? age : null,
    settings: chosen,
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

// A form of ban menus and the host rules, which ride along so nothing is
// held between the command and the form.
export function banForm(choice: DraftChoice, packed: string, data: CivDataResponse, names: CivNames, rules: string | null): ModalBuilder {
  const { leaders, civs } = banMenus(choice, data, names);
  if (leaders.length + civs.length > 4) throw new Error('too many leaders and civs to ban in one form');
  const rulesBox = new TextInputBuilder().setCustomId(RULES_FIELD).setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500);
  if (rules) rulesBox.setValue(rules);
  return new ModalBuilder()
    .setCustomId(customId('draft', BAN_FORM, packed))
    .setTitle(fit(`Bans for your ${editionLabel(choice.edition)} ${MODES[choice.mode]} draft`, 45))
    .addLabelComponents(
      ...leaders.map((options, i) => menuLabel('leaders', options, leaders.length > 1).setStringSelectMenuComponent(menu(leaderField(i), options))),
      ...civs.map((options, i) => menuLabel('civs', options, civs.length > 1).setStringSelectMenuComponent(menu(civField(i), options))),
      new LabelBuilder().setLabel('Host rules').setDescription('Optional. Shown on the draft.').setTextInputComponent(rulesBox),
    );
}

const editionLabel = (edition: Edition): string => (edition === 'civ6' ? 'Civ6' : 'Civ7');

export const draftTitle = (choice: DraftChoice): string => `${editionLabel(choice.edition)} ${MODES[choice.mode]} draft`;

function sizes(choice: DraftChoice): string {
  if (choice.edition === 'civ6') return `${choice.drafts} drafts · ${choice.leaders} leaders each`;
  const age = choice.age ? AGES[choice.age] : 'Every age';
  return `${choice.drafts} drafts · ${choice.leaders} leaders and ${choice.civs} civs each · ${age}`;
}

const listOf = (names: CivNames, tokens: readonly string[]): string => (tokens.length ? tokens.map((t) => nameOf(names, t)).join(' · ') : 'None');

function settingLines(choice: DraftChoice, questions: readonly DraftQuestion[]): string[] {
  return questions.flatMap((q) => {
    const option = q.options.find((o) => o.id === choice.settings[q.id]);
    return option ? [`${q.title}: ${option.label}`] : [];
  });
}

export type DraftView = Readonly<{
  choice: DraftChoice;
  rules: string | null;
  questions: readonly DraftQuestion[];
  deal: DealResponse;
  names: CivNames;
  by: string;
}>;

// Room left in a panel for its heading, subtitle and footer.
const PAGE_TEXT = LIMITS.text - 300;
const PAGE_SEATS = 30;

// The draft as posted: title and rules first, then every seat in order. A
// long draft runs on into more panels; the last says who drafted it.
export function draftPanels(view: DraftView): Panel[] {
  const { choice, deal, names } = view;
  const head: Block[] = [];
  if (view.rules) head.push(field('Host rules', view.rules));
  const settings = settingLines(choice, view.questions);
  if (settings.length) head.push(field('Settings', settings.join('\n')));
  const leaderBans = `Leaders: ${listOf(names, deal.bans.leader)}`;
  head.push(field('Bans', choice.edition === 'civ6' ? leaderBans : `${leaderBans}\nCivs: ${listOf(names, deal.bans.civ)}`));
  const seats = deal.pools.map((pool, i) =>
    choice.edition === 'civ6'
      ? `**Seat ${i + 1}**\n${listOf(names, pool.leaders)}`
      : `**Seat ${i + 1}**\nLeaders: ${listOf(names, pool.leaders)}\nCivs: ${listOf(names, pool.civs)}`,
  );
  const pages: string[][] = [[]];
  let used = head.reduce((sum, b) => sum + ('text' in b ? b.text.length : 0), 0);
  for (const seat of seats) {
    const page = pages[pages.length - 1]!;
    if (page.length && (used + seat.length > PAGE_TEXT || page.length >= PAGE_SEATS)) {
      pages.push([]);
      used = 0;
    }
    pages[pages.length - 1]!.push(seat);
    used += seat.length;
  }
  const title = draftTitle(choice);
  return pages.map((page, i) => ({
    tone: 'info',
    surface: 'draft',
    title: i === 0 ? title : `${title}, continued`,
    ...(i === 0 ? { subtitle: sizes(choice) } : {}),
    body: [...(i === 0 ? head : []), ...page.map(text)],
    ...(i === pages.length - 1 ? { footer: `Drafted by ${mention(view.by)}` } : {}),
  }));
}
