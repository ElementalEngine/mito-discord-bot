import type { Client, Message, SendableChannels } from 'discord.js';

import { ApiClient } from '../api/index.js';
import type { LeaderboardRanking } from '../api/types.js';
import type { Leaderboard } from '../data/types.js';
import { leaderboardsList } from '../data/leaderboards-list.data.js';
import { editText, postText } from '../ui/reply.js';
import { log } from '../utils/log.js';

const api = new ApiClient();

const DAY_MS = 24 * 60 * 60 * 1000;
// A burst of approvals redraws each board once, this long after the last.
const SETTLE_MS = 5_000;
const ROWS_PER_MESSAGE = 10;
const RANK_MESSAGES = 10;
const MESSAGES = RANK_MESSAGES + 2;
const PLACEHOLDER_TEXT = 'Placeholder for leaderboard entry.';
const OURS = /^(`Rank|`#|Last updated:|```)/;
const RANKS = `\`\`\`\n${[
  'Ranks:',
  'Deity ***   2400+',
  'Deity **    2200 - 2399',
  'Deity       2000 - 2199',
  'Immortal    1800 - 1999',
  'Emperor     1600 - 1799',
  'King        1500 - 1599',
  'Prince      1400 - 1499',
  'Warlord     1300 - 1399',
  'Chieftain   1200 - 1299',
  'Settler     1100 - 1199',
  'Builder     1000 - 1099',
  'Scout          0 - 999',
].join('\n\t')}\`\`\``;

/**
 * Two layouts, and the split is measured rather than chosen.
 *
 * `first` is the win count. `wins` counts games where the rating went up,
 * which is about half of all games in every mode by construction -- so the
 * old `wins / games` printed roughly 50% for every player on every board,
 * and `games - wins` was never a loss count (D164, section 4 item 70).
 *
 * Across 340k games duel has `wins == first` exactly and teamer agrees
 * 99.87% of the time, so head-to-head boards show one pair of columns. In
 * FFA and combined the two are five times apart, so both are shown and the
 * rating-gain counter is labelled as a gain, never as a win.
 */
export function getLeaderboardMessage(
  leaderboardRanking: LeaderboardRanking,
  gameMode: string,
  startIdx: number,
  endIdx: number
): string {
  const headToHead = gameMode === 'duel' || gameMode === 'teamer';

  let message = '';
  if (startIdx === 0) {
    message += headToHead
      ? `\`Rank   Skill\t[wins - loss]\tWin%\`\n`
      : `\`Rank   Skill\tGames\t 1st\tWin%\t   ^\`\n`;
  }

  const rankings = leaderboardRanking.rankings;
  for (let i = startIdx; i < endIdx; i++) {
    const entry = rankings[i];
    if (!entry) {
      message += `\`#${i + 1}\`\n`;
      continue;
    }

    const rank = String(`#${i + 1}`).padEnd(4);
    const discordId = entry.discord_id;

    const rating = String(Math.round(entry.rating)).padStart(4);

    const games = entry.games_played;
    const first = entry.first;

    const winPct = games > 0 ? ((first / games) * 100).toFixed(1) : '0.0';
    const winPctStr = `${winPct}%`.padEnd(6);

    if (headToHead) {
      const losses = Math.max(0, games - first);
      const record = `[${String(first).padStart(4)} - ${String(losses).padEnd(4)}]`;
      message += `\`${rank}\t${rating}\t${record}\t${winPctStr}\`\t<@${discordId}>\n`;
      continue;
    }

    const gamesStr = String(games).padStart(5);
    const firstStr = String(first).padStart(4);
    const gains = String(entry.wins).padStart(4);
    message += `\`${rank}\t${rating}\t${gamesStr}\t${firstStr}\t${winPctStr}\t${gains}\`\t<@${discordId}>\n`;
  }

  return message;
}

// Each board's thread and its messages as last seen, so a redraw edits only
// the messages whose text changed. The daily sweep reads them afresh.
type Board = { thread: SendableChannels; messages: Message[] };
const boards = new Map<string, Board>();

const same = (a: string, b: string): boolean => a.trim() === b.trim();

// A board's twelve messages, read from its thread; any missing are posted.
async function boardOf(client: Client, binding: Leaderboard): Promise<Board | null> {
  const held = boards.get(binding.thread_id);
  if (held) return held;
  const thread = await client.channels.fetch(binding.thread_id).catch(() => null);
  if (!thread?.isSendable()) {
    log.warn(`leaderboard ${binding.name}: thread ${binding.thread_id} is not one the bot can post in`);
    return null;
  }
  const fetched = await thread.messages.fetch({ limit: 100 });
  const messages = [...fetched.values()]
    .filter((m) => m.author.id === client.user?.id && (m.content === PLACEHOLDER_TEXT || OURS.test(m.content)))
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .slice(-MESSAGES);
  while (messages.length < MESSAGES) messages.push(await postText(thread, PLACEHOLDER_TEXT));
  const board = { thread, messages };
  boards.set(binding.thread_id, board);
  return board;
}

// A board redrawn from core-api's ranking: only changed messages are edited,
// and nothing is sent when nothing changed.
async function redraw(client: Client, binding: Leaderboard): Promise<void> {
  const board = await boardOf(client, binding);
  if (!board) return;
  const ranking = await api.getLeaderboardRanking(binding.game, binding.game_type, binding.game_mode, binding.is_seasonal, binding.is_combined);
  const texts = [
    ...Array.from({ length: RANK_MESSAGES }, (_, i) => getLeaderboardMessage(ranking, binding.game_mode, i * ROWS_PER_MESSAGE, (i + 1) * ROWS_PER_MESSAGE)),
    RANKS,
  ];
  const changed = texts.flatMap((text, i) => (same(board.messages[i]?.content ?? '', text) ? [] : [i]));
  if (!changed.length) return;
  // Discord refuses edits in an archived thread.
  if (board.thread.isThread() && board.thread.archived) await board.thread.setArchived(false);
  for (const i of changed) board.messages[i] = await editText(board.messages[i]!, texts[i]!);
  board.messages[MESSAGES - 1] = await editText(board.messages[MESSAGES - 1]!, `Last updated: <t:${Math.floor(Date.now() / 1000)}:F>`);
  log.info(`leaderboard ${binding.name}: ${changed.length} message(s) redrawn`);
}

async function redrawSafely(client: Client, binding: Leaderboard): Promise<void> {
  try {
    await redraw(client, binding);
  } catch (error) {
    boards.delete(binding.thread_id);
    log.warn(`leaderboard ${binding.name} not redrawn`, error instanceof Error ? error.message : error);
  }
}

// One redraw at a time, in the order asked.
let queue: Promise<void> = Promise.resolve();
const inQueue = (work: () => Promise<void>): void => {
  queue = queue.then(work).catch((error: unknown) => log.warn('leaderboards not redrawn', error instanceof Error ? error.message : error));
};

// Every board read afresh from Discord and redrawn where it differs: at
// startup, which also checks each binding, and once a day.
async function sweep(client: Client): Promise<void> {
  boards.clear();
  for (const binding of leaderboardsList) await redrawSafely(client, binding);
}

const editions = new Set<string>();
let settle: NodeJS.Timeout | undefined;

// After a rating changes: the edition's boards are redrawn once the burst
// settles, editing only what moved.
export function refreshLeaderboards(client: Client, edition: string): void {
  editions.add(edition);
  clearTimeout(settle);
  settle = setTimeout(() => {
    const due = new Set(editions);
    editions.clear();
    inQueue(async () => {
      for (const binding of leaderboardsList) if (due.has(binding.game)) await redrawSafely(client, binding);
    });
  }, SETTLE_MS);
  settle.unref();
}

export function startUpdateLeaderboardsJob(client: Client): () => void {
  inQueue(() => sweep(client));
  const daily = setInterval(() => inQueue(() => sweep(client)), DAY_MS);
  daily.unref();
  return () => {
    clearInterval(daily);
    clearTimeout(settle);
  };
}
