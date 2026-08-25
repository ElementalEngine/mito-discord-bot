import type {
  Client,
  GuildTextBasedChannel,
  Message,
  Snowflake,
} from 'discord.js';

import { getLeaderboardRanking } from '../services/reporting.service.js';
import type { LeaderboardRanking } from '../api/types.js';
import type { Leaderboard } from '../data/types.js';
import { leaderboardsList } from '../data/leaderboards-list.data.js';

const ONE_HOUR_MS = 60 * 60 * 1000;
const PLACEHOLDER_COUNT = 12;
const PLACEHOLDER_TEXT = 'Placeholder for leaderboard entry.';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toUnixSeconds(ts: number): number {
  return ts > 1_000_000_000_000 ? Math.floor(ts / 1000) : ts;
}

async function fetchLeaderboardThread(
  client: Client,
  threadId: Snowflake
): Promise<GuildTextBasedChannel | null> {
  const ch = await client.channels.fetch(threadId).catch(() => null);
  if (!ch || !ch.isTextBased() || !('messages' in ch)) return null;
  return ch as GuildTextBasedChannel;
}

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

function isLeaderboardUpToDate(
  leaderboardRanking: LeaderboardRanking,
  lastMessage: Message<true>
): boolean {
  const m = lastMessage.content.match(/Last updated: <t:(\d+):F>/);
  if (!m || m.length < 2) return false;

  const lastUpdatedFromMessage = Number.parseInt(m[1], 10);
  if (!Number.isFinite(lastUpdatedFromMessage)) return false;

  const incoming = toUnixSeconds(leaderboardRanking.last_updated);
  return incoming <= lastUpdatedFromMessage;
}

async function ensurePlaceholderMessages(
  thread: GuildTextBasedChannel
): Promise<Message<true>[]> {
  const fetched = await thread.messages.fetch({ limit: 100 }).catch(() => null);
  const candidates: Message<true>[] = fetched
    ? [...fetched.values()]
        .filter((m): m is Message<true> => m.inGuild())
        .filter((m) => m.author.bot)
        .filter((m) => {
          const c = m.content ?? '';
          return (
            c === PLACEHOLDER_TEXT ||
            c.startsWith('`Rank') ||
            c.startsWith('`#') ||
            c.startsWith('Last updated:') ||
            c.startsWith('```')
          );
        })
    : [];

  candidates.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const arr = candidates.slice(-PLACEHOLDER_COUNT);

  while (arr.length < PLACEHOLDER_COUNT) {
    const msg = await thread.send(PLACEHOLDER_TEXT);
    if (msg.inGuild()) arr.push(msg as Message<true>);
    await sleep(1500);
  }

  arr.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return arr;
}

async function printRankings(message: Message<true>): Promise<void> {
  const rankingsStr = ['Ranks:',
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
    'Scout          0 - 999'
  ].join('\n\t');

  await message.edit(`\`\`\`\n${rankingsStr}\`\`\``).catch(() => undefined);
  await sleep(4000);
}

async function updateLeaderboard(
  client: Client,
  leaderboard: Leaderboard
): Promise<void> {
  const thread = await fetchLeaderboardThread(client, leaderboard.thread_id);
  if (!thread) return;

  const messages = await ensurePlaceholderMessages(thread);
  const leaderboardRanking = await getLeaderboardRanking(
    leaderboard.game,
    leaderboard.game_type,
    leaderboard.game_mode,
    leaderboard.is_seasonal,
    leaderboard.is_combined
  );

  const lastMsg = messages[messages.length - 1];
  if (lastMsg && isLeaderboardUpToDate(leaderboardRanking, lastMsg)) {
    return;
  }

  console.log(
    `${new Date().toLocaleTimeString()}: Updating leaderboard: ${leaderboard.name} (${leaderboard.thread_id})`
  );

  for (let i = 0; i < messages.length - 2; i++) {
    const msg = messages[i];
    const leaderboardMsg = getLeaderboardMessage(
      leaderboardRanking,
      leaderboard.game_mode,
      i * 10,
      i * 10 + 10
    );
    await msg.edit(leaderboardMsg).catch(() => undefined);
    await sleep(4000);
  }

  await printRankings(messages[messages.length - 2]);

  const incomingTs = toUnixSeconds(leaderboardRanking.last_updated);
  await messages[messages.length - 1].edit(`Last updated: <t:${incomingTs}:F>`).catch(() => undefined);
  await sleep(4000);
}

async function updateLeaderboards(client: Client): Promise<void> {
  for (const leaderboard of leaderboardsList) {
    await updateLeaderboard(client, leaderboard);
  }
}

export function startUpdateLeaderboardsJob(client: Client): () => void {
  let stopped = false;

  const runOnce = async (): Promise<void> => {
    if (stopped) return;
    try {
      await updateLeaderboards(client);
      console.log('✅ Leaderboards updated successfully');
    } catch (err: unknown) {
      console.error('❌ Failed to update leaderboards:', err);
    }
  };

  void runOnce();

  const interval = setInterval(() => {
    void runOnce();
  }, ONE_HOUR_MS);

  return () => {
    stopped = true;
    clearInterval(interval);
  };
}
