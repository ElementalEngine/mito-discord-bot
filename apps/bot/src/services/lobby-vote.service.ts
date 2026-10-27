import type { Client, Message, SendableChannels } from 'discord.js';

import type { ApiClient } from '../api/index.js';
import type { CivDataResponse, Lobby, LobbyBallot } from '../api/types.js';
import { config } from '../config.js';
import { VOTE_BANS, VOTE_STATUS, lobbyDraftPanels } from '../ui/panels/lobby.js';
import { blindClosedPanel, blindPickPanel, blindStatusPanel, voteBansPanel, voteStatusPanel } from '../ui/panels/lobby-vote.js';
import { editPanel, editPanelById, postPanel } from '../ui/reply.js';
import { log } from '../utils/log.js';
import { civNames, civRows } from './civ-names.js';
import { inLobbyTurn, lobbyViewOf, showLobby } from './lobby.service.js';

// Each open lobby's deadline; after a restart the upkeep job keeps it.
const timers = new Map<string, NodeJS.Timeout>();
// Each blind draft's pool DMs, closed with each player's pick at the reveal.
const poolDms = new Map<string, [string, Message][]>();

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

function schedule(client: Client, lobby: Lobby, api: ApiClient): void {
  clearTimeout(timers.get(lobby.id));
  const ms = Math.max(0, Date.parse(lobby.deadline ?? '') - Date.now() || 0);
  const timer = setTimeout(() => {
    void inLobbyTurn(lobby.id, () => advanceLobby(client, lobby.id, api)).catch((error: unknown) =>
      log.error('lobby not advanced at its deadline', lobby.id, error),
    );
  }, ms);
  timer.unref();
  timers.set(lobby.id, timer);
}

// In the lobby's turn, once it fills or its host starts it: the bans vote is
// posted in the voting channel. A vote that cannot open is counted at once.
export async function openVote(client: Client, lobby: Lobby, api: ApiClient): Promise<void> {
  try {
    const place = await votingChannel(client, lobby);
    const pings = { users: lobby.players.map((p) => p.discord_id) };
    const status = await postPanel(place, voteStatusPanel(lobby), pings);
    const bans = await postPanel(place, voteBansPanel(lobby, await civNames('civ6', api)));
    const messages = { [VOTE_STATUS]: status.id, [VOTE_BANS]: bans.id };
    const placed = await api.placeVote(lobby.id, { id: lobby.host_id }, { channel_id: place.id, messages });
    await showLobby(client, placed, api);
    schedule(client, placed, api);
  } catch (error) {
    log.warn('lobby vote not opened, so it is counted now', lobby.id, error);
    await countVote(client, lobby.id, api);
  }
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
// draft dealt. A blind draft then picks on the vote's status message.
async function countVote(client: Client, lobbyId: string, api: ApiClient): Promise<void> {
  const lobby = await api.lobby(lobbyId);
  if (lobby.status !== 'open' || lobby.phase !== 'voting') return;
  const place = await placeOf(client, lobby);
  const reactions = place ? await banReactions(place, lobby.vote?.messages[VOTE_BANS]) : [];
  const dealt = await api.tallyVote(lobby.id, { id: lobby.host_id }, ballotOf(reactions, lobby, await civRows('civ6', api)));
  const statusId = dealt.vote?.messages[VOTE_STATUS];
  if (dealt.phase === 'picking' && place && statusId) {
    await deleteMessages(place, [dealt.vote?.messages[VOTE_BANS]]);
    await editPanelById(place, statusId, blindStatusPanel(dealt));
    await showLobby(client, dealt, api);
    schedule(client, dealt, api);
    await sendPools(client, dealt, api);
    return;
  }
  if (dealt.phase === 'picking') return revealPicks(client, dealt, api);
  await closeVote(client, dealt);
  await postDraft(client, dealt, place, api);
}

// Each player's pool by DM. A closed DM is logged; that player picks from the
// voting channel instead.
async function sendPools(client: Client, lobby: Lobby, api: ApiClient): Promise<void> {
  const names = await civNames('civ6', api);
  const sent: [string, Message][] = [];
  for (const { player_id: playerId } of lobby.pools) {
    if (!playerId) continue;
    try {
      const dm = await (await client.users.fetch(playerId)).createDM();
      sent.push([playerId, await postPanel(dm, blindPickPanel(lobby, playerId, names))]);
    } catch (error) {
      log.info('blind pool not sent by DM', playerId, error instanceof Error ? error.message : error);
    }
  }
  poolDms.set(lobby.id, sent);
}

// The blind picks revealed together, in the lobby's turn.
async function revealPicks(client: Client, lobby: Lobby, api: ApiClient): Promise<void> {
  const shown = await api.revealPicks(lobby.id, { id: lobby.host_id });
  await closeVote(client, shown);
  await postDraft(client, shown, await placeOf(client, shown), api);
}

// In the lobby's turn: a vote closed, or blind picks revealed, whichever the
// lobby is in. Anything else is left as it is.
export async function advanceLobby(client: Client, lobbyId: string, api: ApiClient): Promise<void> {
  clearTimeout(timers.get(lobbyId));
  timers.delete(lobbyId);
  const lobby = await api.lobby(lobbyId);
  if (lobby.status !== 'open') return;
  if (lobby.phase === 'voting') return countVote(client, lobbyId, api);
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

// A drafted or cancelled lobby's vote messages, deleted from the voting
// channel, and its pool DMs closed.
export async function closeVote(client: Client, lobby: Lobby): Promise<void> {
  clearTimeout(timers.get(lobby.id));
  timers.delete(lobby.id);
  const place = await placeOf(client, lobby);
  if (place) await deleteMessages(place, Object.values(lobby.vote?.messages ?? {}));
  const dms = poolDms.get(lobby.id) ?? [];
  poolDms.delete(lobby.id);
  if (!dms.length) return;
  const names = await civNames('civ6');
  for (const [playerId, message] of dms) await editPanel(message, blindClosedPanel(lobby, playerId, names)).catch(() => undefined);
}
