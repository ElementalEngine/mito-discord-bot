import type { Client, SendableChannels } from 'discord.js';

import type { ApiClient } from '../api/index.js';
import type { Lobby } from '../api/types.js';
import { config } from '../config.js';
import { VOTE_STATUS, lobbyDraftPanels } from '../ui/panels/lobby.js';
import { blindStatusPanel, voteStatusPanel } from '../ui/panels/lobby-vote.js';
import { deleteMessages, editPanelById, postPanel } from '../ui/reply.js';
import { log } from '../utils/log.js';
import { civNames, civRows } from './civ-names.js';
import { dropDeadline, isDue, keepDeadline } from './deadlines.js';
import { lobbyViewOf, showLobby } from './lobby.service.js';
import { BAN_HINT, ballotOf, reactionsOn, unwatchReactions, watchReactions } from './reactions.js';
import { closeMessages, recorded, sendableIn } from './setup.js';

// FFAs and duels draft in the FFA voting channel, teamers in the teamer one.
async function votingChannel(client: Client, lobby: Lobby): Promise<SendableChannels> {
  const c = config.discord.channels;
  const id = lobby.mode === 'teamer' ? c.civ6teamerVote : c.civ6ffaVote;
  const channel = await sendableIn(client, id);
  if (!channel) throw new Error(`voting channel ${id} is not one the bot can post in`);
  return channel;
}

const placeOf = (client: Client, lobby: Lobby): Promise<SendableChannels | null> => sendableIn(client, lobby.vote?.channel_id);

// The lobby advanced at its deadline, if it has one; any older timer dropped.
export function keepTime(client: Client, lobby: Lobby, api: ApiClient): void {
  keepDeadline(lobby.id, lobby.status === 'open' ? lobby.deadline : null, () => advanceLobby(client, lobby.id, api));
}

const placeMessage = (lobby: Lobby, place: SendableChannels, posted: { id: string }, api: ApiClient): Promise<Lobby> =>
  api.placeVote(lobby.id, { id: lobby.host_id }, { channel_id: place.id, messages: { [VOTE_STATUS]: posted.id } });

// In the lobby's turn, once its host starts it or its countdown ends: the bans
// vote posted in the voting channel. A vote that cannot open is counted at once.
export async function openVote(client: Client, lobby: Lobby, api: ApiClient): Promise<void> {
  let placed: Lobby;
  try {
    const place = await votingChannel(client, lobby);
    const pings = { users: lobby.players.map((p) => p.discord_id) };
    const posted = await postPanel(place, voteStatusPanel(lobby, await civNames('civ6', api)), pings);
    placed = await recorded(posted, () => placeMessage(lobby, place, posted, api));
    watchVoteBans(client, placed, posted.id, api);
    void posted.react(BAN_HINT).catch(() => undefined);
  } catch (error) {
    log.warn('lobby vote not opened, so it is counted now', lobby.id, error);
    return countVote(client, lobby, api);
  }
  keepTime(client, placed, api);
  await showLobby(client, placed, api);
}

// The bans so far, sent in the lobby's turn as reactions change; the vote
// message is redrawn when one lands. A ban once landed stays.
function watchVoteBans(client: Client, lobby: Lobby, messageId: string, api: ApiClient): void {
  let landed = lobby.bans.length;
  watchReactions(lobby.id, messageId, async (reactions) => {
    const { ballot } = ballotOf(reactions.get(messageId) ?? [], lobby.players.map((p) => p.discord_id), (await civRows('civ6', api)).leaders);
    const counted = await api.countBallot(lobby.id, { id: lobby.host_id }, ballot);
    if (counted.bans.length === landed) return;
    landed = counted.bans.length;
    const place = await placeOf(client, counted);
    if (place) await editPanelById(place, messageId, voteStatusPanel(counted, await civNames('civ6', api)));
  });
}

// The draft posted in the voting channel and on the lobby's post.
async function postLobbyDraft(client: Client, lobby: Lobby, place: SendableChannels | null, api: ApiClient): Promise<void> {
  if (place) for (const panel of lobbyDraftPanels(await lobbyViewOf(lobby, api))) await postPanel(place, panel);
  await showLobby(client, lobby, api);
}

// In the lobby's turn, once all finish or time is up: the bans counted and the
// draft dealt.
async function countVote(client: Client, lobby: Lobby, api: ApiClient): Promise<void> {
  const place = await placeOf(client, lobby);
  const messageId = lobby.vote?.messages[VOTE_STATUS];
  const reactions = place && messageId ? ((await reactionsOn(place, [messageId])).get(messageId) ?? []) : [];
  const { ballot, unmatched } = ballotOf(reactions, lobby.players.map((p) => p.discord_id), (await civRows('civ6', api)).leaders);
  if (unmatched.length) log.info('ban reactions naming no leader', lobby.id, unmatched.join(', '));
  const dealt = await api.tallyVote(lobby.id, { id: lobby.host_id }, ballot);
  if (dealt.phase === 'picking' && place) return openPicks(client, dealt, place, api);
  if (dealt.phase === 'picking') return revealPicks(client, dealt, api);
  await closeVote(client, dealt);
  await postLobbyDraft(client, dealt, place, api);
}

// A blind draft's message replaces the vote's, so its reactions go with it,
// pinging the players to pick.
async function openPicks(client: Client, lobby: Lobby, place: SendableChannels, api: ApiClient): Promise<void> {
  const posted = await postPanel(place, blindStatusPanel(lobby), { users: lobby.players.map((p) => p.discord_id) });
  const placed = await recorded(posted, () => placeMessage(lobby, place, posted, api));
  keepTime(client, placed, api);
  unwatchReactions([lobby.vote?.messages[VOTE_STATUS]]);
  await deleteMessages(place, [lobby.vote?.messages[VOTE_STATUS]]);
  await showLobby(client, placed, api);
}

// The blind picks revealed together, in the lobby's turn.
async function revealPicks(client: Client, lobby: Lobby, api: ApiClient): Promise<void> {
  const shown = await api.revealPicks(lobby.id, { id: lobby.host_id });
  await closeVote(client, shown);
  await postLobbyDraft(client, shown, await placeOf(client, shown), api);
}

// In the lobby's turn, the step that is due: a countdown's vote opened, a vote
// counted, or blind picks revealed; a vote or the picks end early once all are done.
export async function advanceLobby(client: Client, lobbyId: string, api: ApiClient, allDone = false): Promise<void> {
  const lobby = await api.lobby(lobbyId);
  if (lobby.status !== 'open' || !(isDue(lobby.deadline) || (allDone && lobby.phase !== 'live'))) return;
  dropDeadline(lobbyId);
  if (lobby.phase === 'live') return openVote(client, await api.startLobby(lobby.id, { id: lobby.host_id }), api);
  if (lobby.phase === 'voting') return countVote(client, lobby, api);
  if (lobby.phase === 'picking') return revealPicks(client, lobby, api);
}

// Who has picked, on the blind draft's message.
export async function showBlindStatus(client: Client, lobby: Lobby): Promise<void> {
  const place = await placeOf(client, lobby);
  const statusId = lobby.vote?.messages[VOTE_STATUS];
  if (place && statusId) await editPanelById(place, statusId, blindStatusPanel(lobby));
}

// A drafted or cancelled lobby's vote or blind picks message, deleted from
// the voting channel.
export const closeVote = (client: Client, lobby: Lobby): Promise<void> =>
  closeMessages(client, lobby.id, lobby.vote?.channel_id, Object.values(lobby.vote?.messages ?? {}));
