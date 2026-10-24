import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type MessageActionRowComponentBuilder } from 'discord.js';

import type {
  CivVersion,
  HistoryGame,
  HistoryPage,
  ResetStatsResponse,
  StatRow,
  StatSet,
  StatsGameType,
  StatsSummary,
  TeamGenResponse,
  UserStatsResponse,
} from '../../api/types.js';
import { RANK_DEFS_CIV6 } from '../../config/constants.js';
import {
  customId,
  divider,
  fit,
  iconOf,
  mention,
  plainNameOf,
  signed,
  text,
  when,
  type Block,
  type CivNames,
  type Panel,
} from '../kit/index.js';
import { editionName } from '../../utils/edition.js';
import { mapLabel, ordinal } from './report.js';

const MODES = ['ffa', 'teamer', 'duel'] as const;
const MODE_LABEL: ReadonlyMap<string, string> = new Map([
  ['ffa', 'FFA'],
  ['teamer', 'Teamer'],
  ['duel', 'Duel'],
]);
const LABEL_W = 12;
const COL_W = 7;
const DASH = '\u2014';

// A win is a game that raised the rating, as v1 counted it: an FFA finish
// high enough is a win, and so is every sub-in.
const COUNTERS_NOTE = 'Wins are games that raised your skill. 1st place is finishing first.';

type Line = Readonly<{ label: string; cell: (row: StatRow) => string }>;

const pct = (part: number, whole: number): string => (whole > 0 ? `${Math.round((100 * part) / whole)}%` : DASH);

const LINES: readonly Line[] = [
  { label: 'Skill', cell: (r) => String(r.mu) },
  { label: 'Sigma', cell: (r) => String(Math.round(r.sigma)) },
  { label: 'Games', cell: (r) => String(r.games) },
  { label: 'Wins', cell: (r) => String(r.rating_gains) },
  { label: 'Losses', cell: (r) => String(Math.max(0, r.games - r.rating_gains)) },
  { label: 'Win %', cell: (r) => pct(r.rating_gains, r.games) },
  { label: '1st place', cell: (r) => String(r.first) },
  { label: 'Subbed in', cell: (r) => String(r.subbedIn ?? 0) },
  { label: 'Subbed out', cell: (r) => String(r.subbedOut ?? 0) },
];

// One table per stat set: modes across, counters down. A mode with no games
// is a column of dashes.
export function statTable(set: StatSet): string {
  const head = ''.padEnd(LABEL_W) + MODES.map((m) => (MODE_LABEL.get(m) ?? m).padStart(COL_W)).join('');
  const body = LINES.map(
    (line) =>
      line.label.padEnd(LABEL_W) +
      MODES.map((m) => {
        const row = set[m];
        return (row ? line.cell(row) : DASH).padStart(COL_W);
      }).join(''),
  );
  return ['```', head, ...body, '```'].join('\n');
}

const rankOf = (mu: number | null | undefined) =>
  mu == null || !Number.isFinite(mu) ? undefined : RANK_DEFS_CIV6.find((r) => mu >= r.threshold);

// The panel takes the colour of the rank the lifetime FFA rating reaches.
export function rankAccent(mu: number | null | undefined): number | undefined {
  const rank = rankOf(mu);
  return rank ? Number.parseInt(rank.color.slice(1), 16) : undefined;
}

const rankName = (mu: number | null | undefined): string | null => rankOf(mu)?.name.replace(/_(\d)_STAR$/, ' $1\u2605') ?? null;

const MAP_W = 16;
const MAX_MAPS = 10;

// Games by map, in the stat tables' order: games, wins, win rate, 1st place.
export function mapTable(summary: StatsSummary): string {
  const rows = summary.maps.slice(0, MAX_MAPS);
  const head = 'Map'.padEnd(MAP_W) + ['Games', 'Wins', 'Win %', '1st'].map((h) => h.padStart(COL_W)).join('');
  const body = rows.map(
    (m) =>
      fit(mapLabel(m.map_type), MAP_W - 1).padEnd(MAP_W) +
      [String(m.games), String(m.wins), pct(m.wins, m.games), String(m.firsts)].map((c) => c.padStart(COL_W)).join(''),
  );
  return ['```', head, ...body, '```'].join('\n');
}

// The most played civs (leaders in Civ6), counted like the maps.
export function civLines(summary: StatsSummary, names: CivNames): string {
  return summary.civs
    .map((c, i) => {
      const games = `${c.games} ${c.games === 1 ? 'game' : 'games'}`;
      const wins = `${c.wins} ${c.wins === 1 ? 'win' : 'wins'} (${pct(c.wins, c.games)})`;
      return `${i + 1}. ${iconOf(names, c.token)} ${plainNameOf(names, c.token)} \u00b7 ${games} \u00b7 ${wins} \u00b7 1st place: ${c.firsts}`;
    })
    .join('\n');
}

function summaryBlocks(summary: StatsSummary, names: CivNames): Block[] {
  if (summary.maps.length === 0) return [];
  const blocks = [text(`**Maps**\n${mapTable(summary)}`)];
  if (summary.civs.length) blocks.push(text(`**Most played ${summary.civ_version === 'civ7' ? 'civs' : 'leaders'}**\n${civLines(summary, names)}`));
  return blocks;
}

// Lifetime, then the current season by name; cloud games keep no seasonal ratings.
function sections(stats: UserStatsResponse, lifetime: StatSet, season: StatSet, heading = ''): Block[] {
  const blocks = [text(`**${heading}Lifetime**\n${statTable(lifetime)}`)];
  if (stats.game_type !== 'cloud') blocks.push(text(`**${heading}${stats.season_label ?? 'Season'}**\n${statTable(season)}`));
  return blocks;
}

// The stat tables, then games by map and the most played civs when a
// summary came with them.
export function statsPanel(stats: UserStatsResponse, summary?: StatsSummary, names: CivNames = new Map()): Panel {
  const mu = stats.lifetime.ffa?.mu;
  const accent = rankAccent(mu);
  const rank = rankName(mu);
  const since = summary?.since ? ` Maps and most played count games since the reset on ${when(new Date(summary.since), 'd')}.` : '';
  return {
    tone: 'info',
    surface: 'stats',
    title: 'Stats',
    subtitle: `${editionName(stats.civ_version)} \u00b7 ${stats.game_type}`,
    body: [
      text(rank ? `${mention(stats.discord_id)} \u00b7 **${rank}**` : mention(stats.discord_id)),
      ...sections(stats, stats.lifetime, stats.season),
      ...(summary ? summaryBlocks(summary, names) : []),
    ],
    footer: `${COUNTERS_NOTE}${since}`,
    ...(accent === undefined ? {} : { accent }),
  };
}

// A reset shows the stats as they stood, then as they start again.
export function resetPanel(reset: ResetStatsResponse): Panel {
  return {
    tone: 'success',
    surface: 'stats',
    title: 'Stats reset',
    subtitle: `${editionName(reset.civ_version)} \u00b7 ${reset.game_type}`,
    body: [
      text(`${mention(reset.discord_id)}'s stats are reset.`),
      ...sections(reset, reset.lifetime, reset.season, 'Before \u00b7 '),
      divider(),
      ...sections(reset, reset.after_lifetime, reset.after_season, 'After \u00b7 '),
    ],
    footer: `${COUNTERS_NOTE} After a reset, every mode starts over at the starting skill.`,
  };
}

export const ROOMS = { surface: 'rooms', page: 'page' } as const;

// The room and who asked: only they page through it, as with game history.
export type RoomOf = Readonly<{ civVersion: CivVersion; voiceChannelId: string; asker: string }>;

const roomButton = (of: RoomOf, page: number, label: string, disabled: boolean): ButtonBuilder =>
  new ButtonBuilder()
    .setCustomId(customId(ROOMS.surface, ROOMS.page, of.civVersion, of.voiceChannelId, String(page), of.asker))
    .setLabel(label)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(disabled);

// One message for the room; a large room pages in place.
export function roomPanel(pages: readonly string[], page: number, of: RoomOf, players: number): Panel {
  const at = Math.min(Math.max(page, 0), pages.length - 1);
  const count = `${players} ${players === 1 ? 'player' : 'players'}`;
  return {
    tone: 'info',
    surface: 'rooms',
    title: 'Room ranks',
    subtitle: `<#${of.voiceChannelId}> \u00b7 ${editionName(of.civVersion)} \u00b7 ${count}${pages.length > 1 ? ` \u00b7 page ${at + 1} of ${pages.length}` : ''}`,
    body: [text(pages[at] ?? '')],
    ...(pages.length > 1
      ? {
          actions: [
            new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
              roomButton(of, Math.max(0, at - 1), 'Previous', at === 0),
              roomButton(of, Math.min(pages.length - 1, at + 1), 'Next', at === pages.length - 1),
            ),
          ],
        }
      : {}),
  };
}

export function teamsPanel(result: TeamGenResponse): Panel {
  return {
    tone: 'info',
    surface: 'teams',
    title: 'Teams',
    subtitle: `${editionName(result.civ_version)} \u00b7 ${result.game_type} \u00b7 match quality ${result.game_quality.toFixed(2)}`,
    body: result.teams.map((team, i) => text(`**Team ${i + 1}**\n${team.map(mention).join('\n')}`)),
  };
}

// Two sides is won or lost; more is a place out of how many finished.
function resultOf(g: HistoryGame): string {
  if (g.subbed_out) return 'Left';
  if (g.placement == null) return DASH;
  if (g.sides <= 2) return g.placement === 0 ? '**Won**' : 'Lost';
  return `**${ordinal(g.placement + 1)}** of ${g.sides}`;
}

function pickOf(g: HistoryGame, civVersion: string, names: CivNames): string {
  if (civVersion === 'civ7' && g.civ) {
    const leader = g.leader ? `${iconOf(names, g.leader)} ` : '';
    return `${leader}${iconOf(names, g.civ)} ${plainNameOf(names, g.civ)}`;
  }
  const token = g.leader ?? g.civ;
  return token ? `${iconOf(names, token)} ${plainNameOf(names, token)}` : 'Unknown civ';
}

export function historyLine(g: HistoryGame, civVersion: string, names: CivNames): string {
  const mode = MODE_LABEL.get(g.game_mode.toLowerCase()) ?? (g.game_mode || DASH);
  const parts = [when(new Date(g.reported_at), 'd'), resultOf(g), mode, pickOf(g, civVersion, names), mapLabel(g.map_type), signed(g.delta)];
  if (g.subbed_in) parts.push('subbed in');
  return parts.join(' \u00b7 ');
}

export const HISTORY = { surface: 'history', page: 'page' } as const;

// Who the history is of, and who asked: only they page through it.
export type HistoryOf = Readonly<{ civVersion: CivVersion; mode: StatsGameType; target: string; asker: string }>;

const pageButton = (of: HistoryOf, page: number, label: string, disabled: boolean): ButtonBuilder =>
  new ButtonBuilder()
    .setCustomId(customId(HISTORY.surface, HISTORY.page, of.civVersion, of.mode, of.target, String(page), of.asker))
    .setLabel(label)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(disabled);

export function historyPanel(history: HistoryPage, of: HistoryOf, names: CivNames): Panel {
  const first = history.page * history.page_size + 1;
  const last = history.page * history.page_size + history.games.length;
  const lines = history.games.map((g) => historyLine(g, history.civ_version, names));
  const paged = history.page > 0 || history.has_more;
  return {
    tone: 'info',
    surface: 'stats',
    title: 'Game history',
    subtitle: `${editionName(history.civ_version)} \u00b7 ${history.game_type}${last >= first ? ` \u00b7 games ${first}\u2013${last}, newest first` : ''}`,
    body: [text(mention(history.discord_id)), text(lines.join('\n') || 'No games on this page.')],
    ...(paged
      ? {
          actions: [
            new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
              pageButton(of, Math.max(0, history.page - 1), 'Newer', history.page === 0),
              pageButton(of, history.page + 1, 'Older', !history.has_more),
            ),
          ],
        }
      : {}),
    footer: 'Each line: date, result, mode, civ, map, skill change. Result is your place, or Won or Lost when two sides played.',
  };
}

