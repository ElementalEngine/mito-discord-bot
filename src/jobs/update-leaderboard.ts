import type {
  Client,
  GuildTextBasedChannel,
  Message,
  Snowflake,
} from 'discord.js';

import { getLeaderboardRanking } from '../services/reporting.service.js';
import type { Leaderboard } from '../types/leaderboard.js';
import { leaderboardsList } from '../data/leaderboards-list.js';

type LeaderboardEntry = {
  discord_id: string;
  wins: number;
  first: number;
  rating?: number;
  mu?: number;
  games_played?: number;
  games?: number;
};

type LeaderboardRankingLike = {
  rankings: LeaderboardEntry[];
  last_updated: number; 
};

const ONE_HOUR_MS = 60 * 60 * 1000;
const PLACEHOLDER_COUNT = 11; 

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

function getLeaderboardMessage(
  leaderboardRanking: LeaderboardRankingLike,
  startIdx: number,
  endIdx: number
): string {
  let message = '';
  if (startIdx === 0) {
    message += `\`Rank   Skill\t[wins - loss]\tWin%\t   1st\`\n`;
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

    const skill = entry.rating ?? entry.mu ?? 0;
    const rating = String(Math.round(skill)).padStart(4);

    const games = entry.games_played ?? entry.games ?? 0;
    const wins = entry.wins;
    const losses = Math.max(0, games - wins);

    const winLossRecord = `[${String(wins).padStart(4)} - ${String(losses).padEnd(4)}]`;
    const winPct = games > 0 ? ((wins / games) * 100).toFixed(1) : '0.0';
    const winPctStr = `${winPct}%`.padEnd(6);

    const firstPlaces = String(entry.first).padStart(4);

    message += `\`${rank}\t${rating}\t${winLossRecord}\t${winPctStr}\t${firstPlaces}\`\t<@${discordId}>\n`;
  }

  return message;
}

function isLeaderboardUpToDate(
  leaderboardRanking: LeaderboardRankingLike,
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
  const existing = (await thread.messages.fetch({ limit: PLACEHOLDER_COUNT }))
    .filter((m) => m.inGuild() && m.author.bot);
  await sleep(10_000);

  const arr: Message<true>[] = [...existing.values()] as Message<true>[];
  while (arr.length < PLACEHOLDER_COUNT) {
    const msg = await thread.send('Placeholder for leaderboard entry.');
    if (msg.inGuild()) arr.unshift(msg as Message<true>);
    await sleep(2000);
  }
  arr.reverse();
  return arr;
}

async function updateLeaderboard(
  client: Client,
  leaderboard: Leaderboard
): Promise<void> {
  const thread = await fetchLeaderboardThread(client, leaderboard.thread_id);
  if (!thread) return;

  const messages = await ensurePlaceholderMessages(thread);
  const leaderboardRanking = (await getLeaderboardRanking(
    leaderboard.game,
    leaderboard.game_type,
    leaderboard.game_mode,
    leaderboard.is_seasonal,
    leaderboard.is_combined
  )) as unknown as LeaderboardRankingLike;

  const lastMsg = messages[messages.length - 1];
  if (lastMsg && isLeaderboardUpToDate(leaderboardRanking, lastMsg)) {
    return;
  }

  console.log(
    `${new Date().toLocaleTimeString()}: Updating leaderboard: ${leaderboard.name} (${leaderboard.thread_id})`
  );

  for (let i = 0; i < messages.length - 1; i++) {
    const msg = messages[i];
    const leaderboardMsg = getLeaderboardMessage(
      leaderboardRanking,
      i * 10,
      i * 10 + 10
    );
    await msg.edit(leaderboardMsg);
    await sleep(4000);
  }

  const incomingTs = toUnixSeconds(leaderboardRanking.last_updated);
  await messages[messages.length - 1].edit(`Last updated: <t:${incomingTs}:F>`);
  await sleep(4000);
}

async function updateLeaderboards(client: Client): Promise<void> {
  for (const leaderboard of leaderboardsList) {
    await updateLeaderboard(client, leaderboard);
  }
}

export function startUpdateLeaderboardsJob(client: Client): () => void {
  let stopped = false;
  let running = false;

  const runOnce = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    try {
      await updateLeaderboards(client);
      console.log('✅ Leaderboards updated successfully');
    } catch (err: unknown) {
      console.error('❌ Failed to update leaderboards:', err);
    } finally {
      running = false;
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
