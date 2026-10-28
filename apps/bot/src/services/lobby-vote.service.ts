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

// Each open vote's custom emoji reactions as they come in, by vote message. A
// restart loses them; the final count reads Discord itself.
type LiveVote = { lobby: Lobby; reactions: Map<string, { id: string; name: string; users: Set<string> }>; timer?: NodeJS.Timeout };
const liveVotes = new Map<string, LiveVote>();
const COUNT_DELAY_MS = 1_000;

export type Reaction = Readonly<{ id: string | null; name: string | null; users: readonly string[] }>;

const keyOf = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');

// Each leader under any name a server's emoji may give it: the portrait name,
// the leader's own, or with the civ either side. A name two leaders share is dropped.
function leadersByName(data: CivDataResponse): ReadonlyMap<string, string> {
  const found = new Map<string, string | null>();
  for (const l of data.leaders) {
    const own = l.display ?? '';
    const civ = l.civ_display ?? '';
    for (const key of new Set([l.name, own, civ && own ? civ + own : '', civ && own ? own + civ : ''].filter(Boolean).map(keyOf))) {
      found.set(key, found.has(key) && found.get(key) !== l.token ? null : l.token);
    }
  }
  return new Map([...found].flatMap(([key, token]): [string, string][] => (token ? [[key, token]] : [])));
}

// The ban reactions per server leader emoji, matched by name: the players
// banning each. Others are left out; custom emoji naming no leader come back.
export function ballotOf(reactions: readonly Reaction[], lobby: Lobby, data: CivDataResponse): { ballot: LobbyBallot; unmatched: string[] } {
  const players = new Set(lobby.players.map((p) => p.discord_id));
  const tokenOf = leadersByName(data);
  const bans: Record<string, string[]> = {};
  const unmatched: string[] = [];
  for (const { id, name, users } of reactions) {
    if (!id || !name) continue;
    const token = tokenOf.get(keyOf(name));
    if (!token) unmatched.push(name);
    const voters = users.filter((u) => players.has(u));
    if (!token || !voters.length) continue;
    bans[token] = [...new Set([...(bans[token] ?? []), ...voters])];
  }
  return { ballot: { bans }, unmatched };
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
    liveVotes.set(posted.id, { lobby: placed, reactions: new Map() });
  } catch (error) {
    log.warn('lobby vote not opened, so it is counted now', lobby.id, error);
    return countVote(client, lobby, api);
  }
  keepTime(client, placed, api);
  await showLobby(client, placed, api);
}

function dropLiveVote(messageId: string | undefined): void {
  clearTimeout(messageId ? liveVotes.get(messageId)?.timer : undefined);
  if (messageId) liveVotes.delete(messageId);
}

// A ban reaction added or taken back on an open vote; the count so far is
// sent a second after the last one, so a burst is one call.
export function trackBanReaction(client: Client, messageId: string, emoji: Readonly<{ id: string | null; name: string | null }>, userId: string, added: boolean, api: ApiClient): void {
  const vote = liveVotes.get(messageId);
  if (!vote || !emoji.id || !emoji.name) return;
  const reaction = vote.reactions.get(emoji.id) ?? { id: emoji.id, name: emoji.name, users: new Set<string>() };
  if (added) reaction.users.add(userId);
  else reaction.users.delete(userId);
  vote.reactions.set(emoji.id, reaction);
  clearTimeout(vote.timer);
  vote.timer = setTimeout(() => {
    void inLobbyTurn(vote.lobby.id, () => countSoFar(client, messageId, api)).catch((error: unknown) => log.warn('ban count so far not sent', vote.lobby.id, error));
  }, COUNT_DELAY_MS);
  vote.timer.unref();
}

// In the lobby's turn: the bans so far sent to core-api, and the vote message
// redrawn when one lands. A ban once landed stays.
async function countSoFar(client: Client, messageId: string, api: ApiClient): Promise<void> {
  const vote = liveVotes.get(messageId);
  if (!vote) return;
  const reactions = [...vote.reactions.values()].map((r) => ({ ...r, users: [...r.users] }));
  const { ballot } = ballotOf(reactions, vote.lobby, await civRows('civ6', api));
  const counted = await api.countBallot(vote.lobby.id, { id: vote.lobby.host_id }, ballot);
  const landed = counted.bans.length > vote.lobby.bans.length;
  vote.lobby = counted;
  const place = landed ? await placeOf(client, counted) : null;
  if (place) await editPanelById(place, messageId, voteStatusPanel(counted, await civNames('civ6', api)));
}

// The vote message's reactions, read fresh: the bot does not follow reaction
// events, so its cached copy of the message never has any.
export async function banReactions(place: SendableChannels, messageId: string | undefined): Promise<Reaction[]> {
  const message = messageId ? await place.messages.fetch({ message: messageId, force: true }).catch(() => null) : null;
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
  const { ballot, unmatched } = ballotOf(reactions, lobby, await civRows('civ6', api));
  if (unmatched.length) log.info('ban reactions naming no leader', lobby.id, unmatched.join(', '));
  const dealt = await api.tallyVote(lobby.id, { id: lobby.host_id }, ballot);
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
  dropLiveVote(lobby.vote?.messages[VOTE_STATUS]);
  await deleteMessages(place, [lobby.vote?.messages[VOTE_STATUS]]);
  await showLobby(client, placed, api);
}

// The blind picks revealed together, in the lobby's turn.
async function revealPicks(client: Client, lobby: Lobby, api: ApiClient): Promise<void> {
  const shown = await api.revealPicks(lobby.id, { id: lobby.host_id });
  await closeVote(client, shown);
  await postDraft(client, shown, await placeOf(client, shown), api);
}

// In the lobby's turn, the step that is due: a countdown's vote opened, a vote
// counted, or blind picks revealed; a vote or the picks end early once all are done.
export async function advanceLobby(client: Client, lobbyId: string, api: ApiClient, allDone = false): Promise<void> {
  const lobby = await api.lobby(lobbyId);
  // A second's grace, for a timer or a core-api clock a moment ahead of ours.
  const due = !!lobby.deadline && Date.parse(lobby.deadline) <= Date.now() + 1_000;
  if (lobby.status !== 'open' || !(due || (allDone && lobby.phase !== 'live'))) return;
  dropTimer(lobbyId);
  if (lobby.phase === 'live') return openVote(client, await api.startLobby(lobby.id, { id: lobby.host_id }), api);
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
  dropLiveVote(lobby.vote?.messages[VOTE_STATUS]);
  const place = await placeOf(client, lobby);
  if (place) await deleteMessages(place, Object.values(lobby.vote?.messages ?? {}));
}
