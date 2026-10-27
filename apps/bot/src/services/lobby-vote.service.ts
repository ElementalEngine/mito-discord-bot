import { ThreadAutoArchiveDuration, type Client, type Message, type SendableChannels, type TextBasedChannel } from 'discord.js';

import type { ApiClient } from '../api/index.js';
import type { CivDataResponse, Lobby, LobbyBallot, SettingQuestion } from '../api/types.js';
import { config } from '../config.js';
import { SHAPES, VOTE_BANS, VOTE_STATUS } from '../ui/panels/lobby.js';
import { openQuestions, voteBansPanel, voteCountedPanel, voteQuestionPanel, voteStatusPanel } from '../ui/panels/lobby-vote.js';
import { editPanelById, postPanel } from '../ui/reply.js';
import { log } from '../utils/log.js';
import { civNames, civRows } from './civ-names.js';
import { channelOf, inLobbyTurn, lobbySettings, showLobby } from './lobby.service.js';

// Each running vote's closing time; after a restart the upkeep job counts it.
const timers = new Map<string, NodeJS.Timeout>();

// Discord may echo an emoji back without its variation selector.
const emojiKey = (emoji: string): string => emoji.replace(/️/g, '');

export type Reaction = Readonly<{ id: string | null; name: string | null; users: readonly string[] }>;
export type Reacted = Readonly<{ key: string; reactions: readonly Reaction[] }>;

// The players' reactions as core-api counts them: per open setting by option,
// and per leader portrait by name. Other emoji and other people are left out.
export function ballotOf(reacted: readonly Reacted[], lobby: Lobby, questions: readonly SettingQuestion[], data: CivDataResponse): LobbyBallot {
  const players = new Set(lobby.players.map((p) => p.discord_id));
  const tokenOf = new Map(data.leaders.map((l) => [l.name, l.token]));
  const settings: Record<string, Record<string, string[]>> = {};
  const bans: Record<string, string[]> = {};
  const add = (into: Record<string, string[]>, key: string, users: readonly string[]): void => {
    const voters = users.filter((u) => players.has(u));
    if (voters.length) into[key] = [...new Set([...(into[key] ?? []), ...voters])];
  };
  for (const { key, reactions } of reacted) {
    const question = questions.find((q) => q.id === key);
    for (const { id, name, users } of reactions) {
      if (!name) continue;
      if (key === VOTE_BANS) {
        const token = id ? tokenOf.get(name) : undefined;
        if (token) add(bans, token, users);
        continue;
      }
      const option = id ? undefined : question?.options.find((o) => emojiKey(o.emoji) === emojiKey(name));
      if (question && option) add((settings[question.id] ??= {}), option.id, users);
    }
  }
  return { settings, bans };
}

// A thread off the lobby's post, or the lobby's channel.
async function votePlace(client: Client, lobby: Lobby): Promise<SendableChannels> {
  const channel = await channelOf(client, lobby);
  if (!channel || !lobby.message_id) throw new Error(`lobby ${lobby.id} has no post to vote under`);
  if (config.lobbyVoteIn === 'channel') return channel;
  const post = await channel.messages.fetch(lobby.message_id);
  return post.startThread({ name: `Vote: ${SHAPES[lobby.shape]}`, autoArchiveDuration: ThreadAutoArchiveDuration.OneHour });
}

// The vote's messages cleared: a thread archived, a channel's own messages
// deleted one by one, which needs no Manage Messages.
async function clearPlace(place: TextBasedChannel, ids: readonly string[], statusId: string | undefined, lobby: Lobby): Promise<void> {
  if (place.isThread()) {
    if (statusId) await editPanelById(place, statusId, voteCountedPanel(lobby));
    await place.setLocked(true).catch((error: unknown) => log.warn('vote thread not locked', place.id, error));
    await place.setArchived(true);
    return;
  }
  for (const id of ids) await place.messages.delete(id).catch(() => undefined);
}

function schedule(client: Client, lobby: Lobby, api: ApiClient): void {
  clearTimeout(timers.get(lobby.id));
  const ms = Math.max(0, Date.parse(lobby.vote?.ends_at ?? '') - Date.now() || 0);
  const timer = setTimeout(() => {
    void inLobbyTurn(lobby.id, () => countVote(client, lobby.id, api)).catch((error: unknown) => log.error('lobby vote not counted', lobby.id, error));
  }, ms);
  timer.unref();
  timers.set(lobby.id, timer);
}

// Start, in the lobby's turn: the vote is posted, recorded and linked, its
// option emoji added last. A vote that cannot open is counted at once.
export async function openVote(client: Client, lobby: Lobby, api: ApiClient): Promise<void> {
  const vote = lobby.vote;
  if (!vote) return;
  const [questions, names] = await Promise.all([lobbySettings(lobby.mode, api), civNames('civ6', api)]);
  const posted: [SettingQuestion, Message][] = [];
  const messages: Record<string, string> = {};
  let place: SendableChannels | null = null;
  try {
    place = await votePlace(client, lobby);
    const pings = { users: lobby.players.map((p) => p.discord_id) };
    messages[VOTE_STATUS] = (await postPanel(place, voteStatusPanel(lobby, vote), pings)).id;
    for (const question of openQuestions(lobby, questions)) {
      const message = await postPanel(place, voteQuestionPanel(question));
      messages[question.id] = message.id;
      posted.push([question, message]);
    }
    messages[VOTE_BANS] = (await postPanel(place, voteBansPanel(lobby, names))).id;
    const placed = await api.placeVote(lobby.id, { id: lobby.host_id }, { channel_id: place.id, messages });
    await showLobby(client, placed, api);
    schedule(client, placed, api);
  } catch (error) {
    log.warn('lobby vote not opened, so it is counted now', lobby.id, error);
    if (place) await clearPlace(place, Object.values(messages), undefined, lobby).catch(() => undefined);
    await countVote(client, lobby.id, api);
    return;
  }
  void addOptions(posted);
}

async function addOptions(posted: readonly [SettingQuestion, Message][]): Promise<void> {
  try {
    for (const [question, message] of posted) for (const option of question.options) await message.react(option.emoji);
  } catch (error) {
    log.warn('vote options not all added', error instanceof Error ? error.message : error);
  }
}

async function reactionsOn(place: TextBasedChannel, messages: Readonly<Record<string, string>>): Promise<Reacted[]> {
  const reacted: Reacted[] = [];
  for (const [key, id] of Object.entries(messages)) {
    if (key === VOTE_STATUS) continue;
    const message = await place.messages.fetch(id).catch(() => null);
    if (!message) continue;
    const reactions = [];
    for (const reaction of message.reactions.cache.values()) {
      if (reaction.count <= (reaction.me ? 1 : 0)) continue;
      const users = await reaction.users.fetch();
      reactions.push({ id: reaction.emoji.id, name: reaction.emoji.name, users: [...users.keys()] });
    }
    reacted.push({ key, reactions });
  }
  return reacted;
}

// Close, in the lobby's turn, once all finish or time is up: counted, drafted
// and cleared. A lobby already counted or cancelled is left as it is.
export async function countVote(client: Client, lobbyId: string, api: ApiClient): Promise<void> {
  clearTimeout(timers.get(lobbyId));
  timers.delete(lobbyId);
  const lobby = await api.lobby(lobbyId);
  if (lobby.status !== 'open' || !lobby.vote) return;
  const [questions, data] = await Promise.all([lobbySettings(lobby.mode, api), civRows('civ6', api)]);
  const place = lobby.vote.channel_id ? await client.channels.fetch(lobby.vote.channel_id).catch(() => null) : null;
  const reacted = place?.isTextBased() ? await reactionsOn(place, lobby.vote.messages) : [];
  const drafted = await api.tallyVote(lobby.id, { id: lobby.host_id }, ballotOf(reacted, lobby, questions, data));
  await showLobby(client, drafted, api, true);
  await closeVote(client, drafted);
}

// A counted or cancelled lobby's vote, cleared from where it ran.
export async function closeVote(client: Client, lobby: Lobby): Promise<void> {
  clearTimeout(timers.get(lobby.id));
  timers.delete(lobby.id);
  const vote = lobby.vote;
  if (!vote?.channel_id) return;
  try {
    const place = await client.channels.fetch(vote.channel_id);
    if (place?.isTextBased()) await clearPlace(place, Object.values(vote.messages), vote.messages[VOTE_STATUS], lobby);
  } catch (error) {
    log.warn('lobby vote not cleared', lobby.id, error);
  }
}
