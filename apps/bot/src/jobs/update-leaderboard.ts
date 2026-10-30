import { MessageFlags, escapeMarkdown, type Client, type Guild, type Message, type SendableChannels } from 'discord.js';

import { ApiClient } from '../api/index.js';
import type { Leaderboard } from '../data/types.js';
import { leaderboardsList } from '../data/leaderboards-list.data.js';
import { container, fit, mention } from '../ui/kit/index.js';
import { PAGES, boardPanels } from '../ui/panels/leaderboard.js';
import { deleteMessages, editPanel, postPanel } from '../ui/reply.js';
import { log } from '../utils/log.js';

const api = new ApiClient();

const DAY_MS = 24 * 60 * 60 * 1000;
// A burst of approvals redraws each board once, this long after the last.
const SETTLE_MS = 5_000;
// The text boards these panels replaced: deleted when a board is first read.
const PLACEHOLDER_TEXT = 'Placeholder for leaderboard entry.';
const OURS = /^(`Rank|`#|Last updated:|```)/;
const UPDATED = 'Last updated';

const TYPES: Readonly<Record<string, string>> = { PBC: 'Cloud', Realtime: 'Realtime' };
const MODES: Readonly<Record<string, string>> = { ffa: 'FFA', duel: 'Duel', teamer: 'Teamer', combined: 'Combined' };

// What a panel shows, but for the time it was last updated, as Discord holds it.
function shown(components: readonly { toJSON(): unknown }[]): string {
  const json = JSON.stringify(components.map((c) => c.toJSON()));
  return [...json.matchAll(/"content":"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).filter((t) => !t!.includes(UPDATED)).join('\n');
}

// Each board's thread and its panels as last seen, so a redraw edits only the
// panels whose text changed. The daily sweep reads them afresh.
type Board = { thread: SendableChannels; messages: Message[] };
const boards = new Map<string, Board>();

// A board's panels, read from its thread; the old text boards there are
// deleted and any missing panels posted.
async function boardOf(client: Client, binding: Leaderboard): Promise<Board | null> {
  const held = boards.get(binding.thread_id);
  if (held) return held;
  const thread = await client.channels.fetch(binding.thread_id).catch(() => null);
  if (!thread?.isSendable()) {
    log.warn(`leaderboard ${binding.name}: thread ${binding.thread_id} is not one the bot can post in`);
    return null;
  }
  const fetched = await thread.messages.fetch({ limit: 100 });
  const mine = [...fetched.values()].filter((m) => m.author.id === client.user?.id).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const old = mine.filter((m) => !m.flags.has(MessageFlags.IsComponentsV2) && (m.content === PLACEHOLDER_TEXT || OURS.test(m.content)));
  if (old.length) {
    if (thread.isThread() && thread.archived) await thread.setArchived(false);
    await deleteMessages(thread, old.map((m) => m.id));
    log.info(`leaderboard ${binding.name}: ${old.length} old text message(s) removed`);
  }
  const messages = mine.filter((m) => m.flags.has(MessageFlags.IsComponentsV2)).slice(-PAGES);
  const board = { thread, messages };
  boards.set(binding.thread_id, board);
  return board;
}

// Server names for the board; one whose fetch answered and who is not in the
// server has left, and anyone unread while Discord is slow is mentioned.
async function namesOf(guild: Guild | null, ids: readonly string[]): Promise<Map<string, string>> {
  if (!guild) return new Map();
  const missing = ids.filter((id) => !guild.members.cache.has(id));
  const answered = !missing.length || (await guild.members.fetch({ user: missing, time: 5_000 }).then(() => true, () => false));
  return new Map(
    ids.map((id): [string, string] => {
      const member = guild.members.cache.get(id);
      if (member) return [id, escapeMarkdown(fit(member.displayName, 32))];
      return [id, answered ? '*former member*' : mention(id)];
    }),
  );
}

async function titleOf(binding: Leaderboard): Promise<string> {
  const edition = binding.game === 'civ7' ? 'Civ7' : 'Civ6';
  const board = `${edition} ${TYPES[binding.game_type] ?? binding.game_type} ${MODES[binding.game_mode] ?? binding.game_mode}`;
  if (!binding.is_seasonal) return `${board} \u00b7 Lifetime`;
  const season = await api.getSeason(binding.game === 'civ7' ? 'civ7' : 'civ6').then((s) => s.label, () => 'Season');
  return `${board} \u00b7 ${season}`;
}

// A board redrawn from core-api's ranking: only changed panels are edited,
// with the last re-stamped, and nothing is sent when nothing changed.
async function redraw(client: Client, binding: Leaderboard): Promise<void> {
  const board = await boardOf(client, binding);
  if (!board) return;
  const ranking = await api.getLeaderboardRanking(binding.game, binding.game_type, binding.game_mode, binding.is_seasonal, binding.is_combined);
  const guild = 'guild' in board.thread ? (board.thread.guild as Guild) : null;
  const names = await namesOf(guild, ranking.rankings.map((r) => r.discord_id));
  const panels = boardPanels({ title: await titleOf(binding), mode: binding.game_mode, ranking, names, updated: new Date() });
  const changed = panels.flatMap((panel, i) => {
    const message = board.messages[i];
    return message && shown(message.components) === shown([container(panel)]) ? [] : [i];
  });
  const extra = board.messages.slice(panels.length);
  if (!changed.length && !extra.length) return;
  // Discord refuses edits in an archived thread.
  if (board.thread.isThread() && board.thread.archived) await board.thread.setArchived(false);
  // A board that shrank, as after a season reset, loses its trailing panels.
  if (extra.length) await deleteMessages(board.thread, extra.map((m) => m.id));
  board.messages = board.messages.slice(0, panels.length);
  for (const i of new Set([...changed, panels.length - 1])) {
    const message = board.messages[i];
    board.messages[i] = message ? await editPanel(message, panels[i]!) : await postPanel(board.thread, panels[i]!);
  }
  log.info(`leaderboard ${binding.name}: ${changed.length} panel(s) redrawn, ${extra.length} removed`);
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
