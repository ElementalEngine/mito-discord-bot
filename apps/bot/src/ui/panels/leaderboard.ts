import type { LeaderboardRanking } from '../../api/types.js';
import { RANK_DEFS_CIV6 } from '../../config/constants.js';
import { mention, text, when, type Block, type Panel } from '../kit/index.js';
import { rankAccent, rankName } from './stats.js';

// A board is its top 100, 25 to a message, so each fits Discord's text limit.
export const PAGE_ROWS = 25;
export const PAGES = 4;
const SHOWN = PAGE_ROWS * PAGES;

const MEDALS = ['\u{1f947}', '\u{1f948}', '\u{1f949}'];
const RANK_KEY = `Ranks: ${RANK_DEFS_CIV6.map((r) => `${rankName(r.threshold)} ${r.threshold || ''}`.trim()).join(' \u00b7 ')}`;

type Entry = LeaderboardRanking['rankings'][number];

export type BoardView = Readonly<{
  title: string;
  mode: string;
  ranking: LeaderboardRanking;
  // Each player's name as shown; anyone missing is mentioned.
  names: ReadonlyMap<string, string>;
  updated: Date;
}>;

// Duel and teamer count a win against a loss; FFA and combined count 1st places.
const headToHead = (mode: string): boolean => mode === 'duel' || mode === 'teamer';

const chips = (cells: readonly string[]): string => cells.map((c) => `\`${c}\``).join(' ');

function headingLine(h2h: boolean): string {
  return `${chips(h2h ? ['Rank', 'Skill', ' Won', 'Lost', '  Win%'] : ['Rank', 'Skill', 'Games', ' 1st', '  Win%'])} \u2014 **Player**`;
}

// Win% is 1st places over games; the rating-gain counter is not a win.
function rowLine(at: number, entry: Entry, h2h: boolean, name: string): string {
  const games = entry.games_played;
  const first = entry.first;
  const pct = `${games > 0 ? ((first / games) * 100).toFixed(1) : '0.0'}%`;
  const counts = h2h ? [String(first).padStart(4), String(Math.max(0, games - first)).padStart(4)] : [String(games).padStart(5), String(first).padStart(4)];
  const cells = [`#${at + 1}`.padEnd(4), String(Math.round(entry.rating)).padStart(5), ...counts, pct.padStart(6)];
  const medal = MEDALS[at] ? `${MEDALS[at]} ` : '';
  const rank = rankName(entry.rating);
  return `${chips(cells)} \u2014 ${medal}**${name}**${rank ? ` \u00b7 *${rank}*` : ''}`;
}

// The board as its messages, one per 25 players up to four: column headings on
// each, the title on the first, the rank key and the last change on the last.
export function boardPanels(view: BoardView): Panel[] {
  const h2h = headToHead(view.mode);
  const rows = view.ranking.rankings.slice(0, SHOWN);
  const accent = rankAccent(rows[0]?.rating);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_ROWS));
  return Array.from({ length: pages }, (_, page) => {
    const start = page * PAGE_ROWS;
    const shown = rows.slice(start, start + PAGE_ROWS);
    const body: Block[] = shown.length
      ? [text([headingLine(h2h), ...shown.map((e, i) => rowLine(start + i, e, h2h, view.names.get(e.discord_id) ?? mention(e.discord_id)))].join('\n'))]
      : [text('No rated games yet.')];
    const last = page === pages - 1;
    if (last) body.push(text(`-# ${RANK_KEY}`));
    return {
      tone: 'info',
      surface: 'leaderboard',
      ...(accent === undefined ? {} : { accent }),
      ...(page === 0 ? { title: view.title, subtitle: 'Best first \u00b7 Win% is 1st places over games played' } : {}),
      body,
      ...(last ? { footer: `Last updated ${when(view.updated, 'f')}` } : {}),
    };
  });
}
