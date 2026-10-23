import type { StatRow, StatSet, TeamGenResponse, UserStatsResponse } from '../../api/types.js';
import { RANK_DEFS_CIV6 } from '../../config/constants.js';
import { mention, text, type Block, type Panel } from '../kit/index.js';

type Mode = 'ffa' | 'teamer' | 'duel';
const MODES: readonly Mode[] = ['ffa', 'teamer', 'duel'];
const HEADERS: Readonly<Record<Mode, string>> = { ffa: 'FFA', teamer: 'Teamer', duel: 'Duel' };
const LABEL_W = 12;
const COL_W = 7;
const DASH = '\u2014';

// A win is first place in every mode. Rating gains count games where the
// rating went up: about half of all games by construction, so never a win.
const COUNTERS_NOTE = 'A win is first place. Rating gains count games where the rating went up.';

type Line = Readonly<{ label: string; cell: (row: StatRow, mode: Mode) => string }>;

const pct = (part: number, whole: number): string => (whole > 0 ? `${Math.round((100 * part) / whole)}%` : DASH);
const headToHead = (mode: Mode): boolean => mode !== 'ffa';

const LINES: readonly Line[] = [
  { label: 'Skill', cell: (r) => String(r.mu) },
  { label: 'Sigma', cell: (r) => String(Math.round(r.sigma)) },
  { label: 'Games', cell: (r) => String(r.games) },
  { label: 'Wins', cell: (r) => String(r.first) },
  { label: 'Losses', cell: (r, m) => (headToHead(m) ? String(Math.max(0, r.games - r.first)) : DASH) },
  { label: 'Win %', cell: (r) => pct(r.first, r.games) },
  { label: 'Rating gains', cell: (r, m) => (headToHead(m) ? DASH : String(r.rating_gains)) },
  { label: 'Subbed in', cell: (r) => String(r.subbedIn ?? 0) },
  { label: 'Subbed out', cell: (r) => String(r.subbedOut ?? 0) },
];

// One table per stat set: modes across, counters down. A mode with no games
// is a column of dashes.
export function statTable(set: StatSet): string {
  const head = ''.padEnd(LABEL_W) + MODES.map((m) => HEADERS[m].padStart(COL_W)).join('');
  const body = LINES.map(
    (line) =>
      line.label.padEnd(LABEL_W) +
      MODES.map((m) => {
        const row = set[m];
        return (row ? line.cell(row, m) : DASH).padStart(COL_W);
      }).join(''),
  );
  return ['```', head, ...body, '```'].join('\n');
}

// The panel takes the colour of the rank the lifetime FFA rating reaches.
export function rankAccent(mu: number | null | undefined): number | undefined {
  if (mu == null || !Number.isFinite(mu)) return undefined;
  const rank = RANK_DEFS_CIV6.find((r) => mu >= r.threshold);
  return rank ? Number.parseInt(rank.color.slice(1), 16) : undefined;
}

const editionLabel = (civVersion: string): string => civVersion.replace(/^civ/i, 'Civ');

function sections(stats: UserStatsResponse): Block[] {
  const blocks = [text(`**Lifetime**\n${statTable(stats.lifetime)}`)];
  // Cloud games keep no seasonal ratings.
  if (stats.game_type !== 'cloud') blocks.push(text(`**Season**\n${statTable(stats.season)}`));
  return blocks;
}

export function statsPanel(stats: UserStatsResponse): Panel {
  const accent = rankAccent(stats.lifetime.ffa?.mu);
  return {
    tone: 'info',
    surface: 'stats',
    title: 'Stats',
    subtitle: `${editionLabel(stats.civ_version)} \u00b7 ${stats.game_type}`,
    body: [text(mention(stats.discord_id)), ...sections(stats)],
    footer: COUNTERS_NOTE,
    ...(accent === undefined ? {} : { accent }),
  };
}

// A reset answers with the stats as they stood before it.
export function resetPanel(before: UserStatsResponse): Panel {
  return {
    tone: 'success',
    surface: 'stats',
    title: 'Stats reset',
    subtitle: `${editionLabel(before.civ_version)} \u00b7 ${before.game_type}`,
    body: [text(`${mention(before.discord_id)}'s stats are reset. Before the reset:`), ...sections(before)],
    footer: COUNTERS_NOTE,
  };
}

export function roomPanel(page: string, voiceChannelId: string, players: number, part?: Readonly<{ n: number; of: number }>): Panel {
  const count = `${players} ${players === 1 ? 'player' : 'players'}`;
  return {
    tone: 'info',
    surface: 'rooms',
    title: 'Room ranks',
    subtitle: `<#${voiceChannelId}> \u00b7 ${count}${part && part.of > 1 ? ` \u00b7 page ${part.n} of ${part.of}` : ''}`,
    body: [text(page)],
  };
}

export function teamsPanel(result: TeamGenResponse): Panel {
  return {
    tone: 'info',
    surface: 'teams',
    title: 'Teams',
    subtitle: `${editionLabel(result.civ_version)} \u00b7 ${result.game_type} \u00b7 match quality ${result.game_quality.toFixed(2)}`,
    body: result.teams.map((team, i) => text(`**Team ${i + 1}**\n${team.map(mention).join('\n')}`)),
  };
}
