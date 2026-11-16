import type { LeaderboardRanking } from '../../api/types.js';
import { RANK_DEFS_CIV6 } from '../../config/constants.js';
import { mention, text, when, type Block, type Panel } from '../kit/index.js';
import { rankAccent, rankName } from './stats.js';

// A board is its top 100, 25 to a message, so each fits Discord's text limit.
export const PAGE_ROWS = 25;
export const PAGES = 4;
const SHOWN = PAGE_ROWS * PAGES;
// Rows go in blocks of five: Discord cut the last row of one long text block.
const BLOCK_ROWS = 5;

const MEDALS = ['\u{1f947}', '\u{1f948}', '\u{1f949}'];
const RANK_KEY = `Ranks: ${RANK_DEFS_CIV6.map((r) => `${rankName(r.threshold)} ${r.threshold || ''}`.trim()).join(' \u00b7 ')}`;

type Entry = LeaderboardRanking['rankings'][number];

export type BoardView = Readonly<{
  title: string;
  mode: string;
  ranking: LeaderboardRanking;
  updated: Date;
}>;

const chips = (cells: readonly string[]): string => cells.map((c) => `\`${c}\``).join(' ');

// Every board has the columns /stats has, in its order. A win is a game that
// raised the player's rating; Win% is wins over games.
const HEADING = `${chips(['Rank', 'Skill', 'Games', 'Wins', '  Win%', ' 1st'])} \u2014 **Player**`;

function rowLine(at: number, entry: Entry): string {
  const games = entry.games_played;
  const pct = `${games > 0 ? ((entry.wins / games) * 100).toFixed(1) : '0.0'}%`;
  const cells = [
    `#${at + 1}`.padEnd(4),
    String(Math.round(entry.rating)).padStart(5),
    String(games).padStart(5),
    String(entry.wins).padStart(4),
    pct.padStart(6),
    String(entry.first).padStart(4),
  ];
  const medal = MEDALS[at] ? `${MEDALS[at]} ` : '';
  const rank = rankName(entry.rating);
  return `${chips(cells)} \u2014 ${medal}${mention(entry.discord_id)}${rank ? ` \u00b7 *${rank}*` : ''}`;
}

// The board as its messages, one per 25 players up to four: column headings on
// each, the title on the first, the rank key and the last change on the last.
export function boardPanels(view: BoardView): Panel[] {
  const rows = view.ranking.rankings.slice(0, SHOWN);
  const accent = rankAccent(rows[0]?.rating);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_ROWS));
  return Array.from({ length: pages }, (_, page) => {
    const start = page * PAGE_ROWS;
    const shown = rows.slice(start, start + PAGE_ROWS);
    const lines = shown.map((e, i) => rowLine(start + i, e));
    const body: Block[] = shown.length
      ? Array.from({ length: Math.ceil(lines.length / BLOCK_ROWS) }, (_, b) =>
          text([...(b === 0 ? [HEADING] : []), ...lines.slice(b * BLOCK_ROWS, (b + 1) * BLOCK_ROWS)].join('\n')),
        )
      : [text('No rated games yet.')];
    const last = page === pages - 1;
    if (last) body.push(text(`-# ${RANK_KEY}`));
    return {
      tone: 'info',
      surface: 'leaderboard',
      ...(accent === undefined ? {} : { accent }),
      ...(page === 0 ? { title: view.title, subtitle: 'Best first \u00b7 Wins are games that raised the rating' } : {}),
      body,
      ...(last ? { footer: `Last updated ${when(view.updated, 'f')}` } : {}),
    };
  });
}
