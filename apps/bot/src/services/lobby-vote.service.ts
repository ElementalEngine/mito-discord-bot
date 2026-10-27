import type { Client, Message, SendableChannels } from 'discord.js';

import type { ApiClient } from '../api/index.js';
import type { CivDataResponse, Lobby, LobbyBallot } from '../api/types.js';
import { config } from '../config.js';
import { VOTE_STATUS, lobbyDraftPanels } from '../ui/panels/lobby.js';
import { blindStatusPanel, voteStatusPanel } from '../ui/panels/lobby-vote.js';
import { editPanelById, postPanel } from '../ui/reply.js';
import { log } from '../utils/log.js';
import { civNames, civRows } from './civ-names.js';
import { inLobbyTurn, lobbyViewOf, showLobby } from './lobby.service.js';

// Each open lobby's deadline: a full lobby's countdown, a vote's or the blind
// picks'. After a restart the upkeep job keeps it.
const timers = new Map<string, NodeJS.Timeout>();

export type Reaction = Readonly<{ id: string | null; name: string | null; users: readonly string[] }>;

// The ban reactions as core-api counts them: per leader portrait, matched by
// name, the players banning it. Other emoji and other people are left out.
export function ballotOf(reactions: readonly Reaction[], lobby: Lobby, data: CivDataResponse): LobbyBallot {
  const players = new Set(lobby.players.map((p) => p.discord_id));
  const tokenOf: ReadonlyMap<string, string> = new Map(data.leaders.map((l) => [l.name, l.token]));
  const bans: Record<string, string[]> = {};
  for (const { id, name, users } of reactions) {
    const token = id && name ? tokenOf.get(name) : undefined;
    const voters = users.filter((u) => players.has(u));
    if (!token || !voters.length) continue;
    bans[token] = [...new Set([...(bans[token] ?? []), ...voters])];
  }
  return { bans };
}

// FFAs and duels draft in the FFA voting channel, teamers in the teamer one.
async function votingChannel(client: Client, lobby: Lobby): Promise<SendableChannels> {
  const c = config.discord.channels;
  const id = lobby.mode === 'teamer' ? c.civ6teamerVote : c.civ6ffaVote;
  const channel = await client.channels.fetch(id);
  if (!channel?.isSendable()) throw new Error(`voting channel ${id} is not one the bot can post in`);
  return channel;
}

async function placeOf(client: Client, lobby: Lobby): Promise<SendableChannels | null> {
  const id = lobby.vote?.channel_id;
  const channel = id ? await client.channels.fetch(id).catch(() => null) : null;
  return channel?.isSendable() ? channel : null;
}

function dropTimer(lobbyId: string): void {
  clearTimeout(timers.get(lobbyId));
  timers.delete(lobbyId);
}

// The lobby advanced at its deadline, if it has one; any older timer dropped.
export function keepTime(client: Client, lobby: Lobby, api: ApiClient): void {
  dropTimer(lobby.id);
  if (lobby.status !== 'open' || !lobby.deadline) return;
  const ms = Math.max(0, Date.parse(lobby.deadline) - Date.now() || 0);
  const timer = setTimeout(() => {
    void inLobbyTurn(lobby.id, () => advanceLobby(client, lobby.id, api)).catch((error: unknown) =>
      log.error('lobby not advanced at its deadline', lobby.id, error),
    );
  }, ms);
  timer.unref();
  timers.set(lobby.id, timer);
}

// The vote's or blind picks' message recorded; one that cannot be is deleted.
async function placeMessage(lobby: Lobby, place: SendableChannels, posted: Message, api: ApiClient): Promise<Lobby> {
  try {
    return await api.placeVote(lobby.id, { id: lobby.host_id }, { channel_id: place.id, messages: { [VOTE_STATUS]: posted.id } });
  } catch (error) {
    await posted.delete().catch(() => undefined);
    throw error;
  }
}

// In the lobby's turn, once its host starts it or its countdown ends: the bans
// vote posted in the voting channel. A vote that cannot open is counted at once.
export async function openVote(client: Client, lobby: Lobby, api: ApiClient): Promise<void> {
  let placed: Lobby;
  try {
    const place = await votingChannel(client, lobby);
    const pings = { users: lobby.players.map((p) => p.discord_id) };
    const posted = await postPanel(place, voteStatusPanel(lobby, await civNames('civ6', api)), pings);
    placed = await placeMessage(lobby, place, posted, api);
  } catch (error) {
    log.warn('lobby vote not opened, so it is counted now', lobby.id, error);
    return countVote(client, lobby, api);
  }
  keepTime(client, placed, api);
  await showLobby(client, placed, api);
}

async function banReactions(place: SendableChannels, messageId: string | undefined): Promise<Reaction[]> {
  const message = messageId ? await place.messages.fetch(messageId).catch(() => null) : null;
  const reactions: Reaction[] = [];
  for (const reaction of message?.reactions.cache.values() ?? []) {
    const users = await reaction.users.fetch();
    reactions.push({ id: reaction.emoji.id, name: reaction.emoji.name, users: [...users.keys()] });
  }
  return reactions;
}

// The draft posted in the voting channel and on the lobby's post.
async function postDraft(client: Client, lobby: Lobby, place: SendableChannels | null, api: ApiClient): Promise<void> {
  if (place) for (const panel of lobbyDraftPanels(await lobbyViewOf(lobby, api))) await postPanel(place, panel);
  await showLobby(client, lobby, api);
}

// In the lobby's turn, once all finish or time is up: the bans counted and the
// draft dealt.
async function countVote(client: Client, lobby: Lobby, api: ApiClient): Promise<void> {
  const place = await placeOf(client, lobby);
  const reactions = place ? await banReactions(place, lobby.vote?.messages[VOTE_STATUS]) : [];
  const dealt = await api.tallyVote(lobby.id, { id: lobby.host_id }, ballotOf(reactions, lobby, await civRows('civ6', api)));
  if (dealt.phase === 'picking' && place) return openPicks(client, dealt, place, api);
  if (dealt.phase === 'picking') return revealPicks(client, dealt, api);
  await closeVote(client, dealt);
  await postDraft(client, dealt, place, api);
}

// A blind draft's message replaces the vote's, so its reactions go with it,
// pinging the players to pick.
async function openPicks(client: Client, lobby: Lobby, place: SendableChannels, api: ApiClient): Promise<void> {
  const posted = await postPanel(place, blindStatusPanel(lobby), { users: lobby.players.map((p) => p.discord_id) });
  const placed = await placeMessage(lobby, place, posted, api);
  keepTime(client, placed, api);
  await deleteMessages(place, [lobby.vote?.messages[VOTE_STATUS]]);
  await showLobby(client, placed, api);
}

// The blind picks revealed together, in the lobby's turn.
async function revealPicks(client: Client, lobby: Lobby, api: ApiClient): Promise<void> {
  const shown = await api.revealPicks(lobby.id, { id: lobby.host_id });
  await closeVote(client, shown);
  await postDraft(client, shown, await placeOf(client, shown), api);
}

// In the lobby's turn, whichever step is due: a full lobby's vote opened at
// the end of its countdown, a vote counted, or blind picks revealed.
export async function advanceLobby(client: Client, lobbyId: string, api: ApiClient): Promise<void> {
  dropTimer(lobbyId);
  const lobby = await api.lobby(lobbyId);
  if (lobby.status !== 'open') return;
  if (lobby.phase === 'live' && lobby.deadline && Date.parse(lobby.deadline) <= Date.now()) {
    return openVote(client, await api.startLobby(lobby.id, { id: lobby.host_id }), api);
  }
  if (lobby.phase === 'voting') return countVote(client, lobby, api);
  if (lobby.phase === 'picking') return revealPicks(client, lobby, api);
}

async function deleteMessages(place: SendableChannels, ids: readonly (string | undefined)[]): Promise<void> {
  for (const id of ids) if (id) await place.messages.delete(id).catch(() => undefined);
}

// Who has picked, on the blind draft's message.
export async function showBlindStatus(client: Client, lobby: Lobby): Promise<void> {
  const place = await placeOf(client, lobby);
  const statusId = lobby.vote?.messages[VOTE_STATUS];
  if (place && statusId) await editPanelById(place, statusId, blindStatusPanel(lobby));
}

// A drafted or cancelled lobby's vote or blind picks message, deleted from
// the voting channel.
export async function closeVote(client: Client, lobby: Lobby): Promise<void> {
  dropTimer(lobby.id);
  const place = await placeOf(client, lobby);
  if (place) await deleteMessages(place, Object.values(lobby.vote?.messages ?? {}));
}
