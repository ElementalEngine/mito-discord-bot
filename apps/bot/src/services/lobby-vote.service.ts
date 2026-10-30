import type { Client, Message, MessageMentionOptions, SendableChannels } from 'discord.js';

import type { ApiClient } from '../api/index.js';
import type { Lobby, LobbyBallot, SettingQuestion } from '../api/types.js';
import { config } from '../config.js';
import type { Panel } from '../ui/kit/index.js';
import { VOTE_STATUS, lobbyDraftPanels } from '../ui/panels/lobby.js';
import { blindStatusPanel, bansVotePanel, votedOn } from '../ui/panels/lobby-vote.js';
import { questionPanel } from '../ui/panels/vote.js';
import { deleteMessages, editPanelById, postPanel } from '../ui/reply.js';
import { log } from '../utils/log.js';
import { civNames, civRows } from './civ-names.js';
import { dropDeadline, isDue, keepDeadline } from './deadlines.js';
import { lobbySettings, lobbyViewOf, showLobby } from './lobby.service.js';
import { BAN_HINT, backingOf, ballotOf, reactionsOn, unwatchReactions, watchReactions, type Reaction } from './reactions.js';
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

const questionsOf = (lobby: Lobby, api: ApiClient): Promise<readonly SettingQuestion[]> => lobbySettings(lobby.mode, api);

// The ballot from each message's reactions: per setting still put to the vote,
// the backers of each option; per leader, from the status message, its backers.
async function lobbyBallot(lobby: Lobby, reactionsOf: (key: string) => readonly Reaction[], questions: readonly SettingQuestion[], api: ApiClient) {
  const players = lobby.players.map((p) => p.discord_id);
  const { ballot, unmatched } = ballotOf(reactionsOf(VOTE_STATUS), players, (await civRows('civ6', api)).leaders);
  const settings = Object.fromEntries(votedOn(lobby, questions).map((q) => [q.id, backingOf(q, reactionsOf(q.id), new Set(players))]));
  return { ballot: { ...ballot, settings } satisfies LobbyBallot, unmatched };
}

// Once the lobby starts: its status, then a message per setting put to the vote,
// each watched as it posts. A vote that cannot open is counted at once.
export async function openVote(client: Client, lobby: Lobby, api: ApiClient): Promise<void> {
  let placed: Lobby;
  const messages: Record<string, string> = {};
  let place: SendableChannels | null = null;
  try {
    const where = await votingChannel(client, lobby);
    place = where;
    const [questions, names] = await Promise.all([questionsOf(lobby, api), civNames('civ6', api)]);
    const votes = voteCounter(lobby, where, messages, questions, api);
    const post = async (key: string, panel: Panel, pings?: MessageMentionOptions): Promise<Message> => {
      const posted = await postPanel(where, panel, pings);
      messages[key] = posted.id;
      watchReactions(lobby.id, posted.id, votes.count);
      return posted;
    };
    const status = await post(VOTE_STATUS, bansVotePanel(lobby, names, questions), { users: lobby.players.map((p) => p.discord_id) });
    void status.react(BAN_HINT).catch(() => undefined);
    // Each setting's options are added in turn; one won meanwhile gets no more.
    let seeding = Promise.resolve();
    for (const question of votedOn(lobby, questions)) {
      const posted = await post(question.id, questionPanel(question));
      seeding = seeding
        .then(async () => {
          for (const option of question.options) if (votes.open(question)) await posted.react(option.emoji);
        })
        .catch((error: unknown) => log.warn('setting reactions not all added', lobby.id, error instanceof Error ? error.message : error));
    }
    placed = await api.placeVote(lobby.id, { id: lobby.host_id }, { channel_id: where.id, messages });
  } catch (error) {
    log.warn('lobby vote not opened, so it is counted now', lobby.id, error);
    const posted = Object.values(messages);
    unwatchReactions(posted);
    if (place) await deleteMessages(place, posted);
    return countVote(client, lobby, api);
  }
  keepTime(client, placed, api);
  await showLobby(client, placed, api);
}

// The votes so far, sent in the lobby's turn as reactions change. A setting a
// majority wins has its message cleared; the status is redrawn when a setting or a ban lands.
function voteCounter(lobby: Lobby, place: SendableChannels, messages: Readonly<Record<string, string>>, questions: readonly SettingQuestion[], api: ApiClient) {
  let last = lobby;
  const count = async (reactions: ReadonlyMap<string, readonly Reaction[]>): Promise<void> => {
    const before = last;
    const { ballot } = await lobbyBallot(before, (key) => reactions.get(messages[key] ?? '') ?? [], questions, api);
    last = await api.countBallot(lobby.id, { id: lobby.host_id }, ballot);
    const open = votedOn(last, questions);
    const won = votedOn(before, questions).filter((q) => !open.includes(q)).map((q) => messages[q.id]);
    if (!won.length && last.bans.length === before.bans.length) return;
    unwatchReactions(won);
    await deleteMessages(place, won);
    await editPanelById(place, messages[VOTE_STATUS] ?? '', bansVotePanel(last, await civNames('civ6', api), questions));
  };
  return { count, open: (question: SettingQuestion): boolean => votedOn(last, questions).includes(question) };
}

// The draft posted in the voting channel and on the lobby's post.
async function postLobbyDraft(client: Client, lobby: Lobby, place: SendableChannels | null, api: ApiClient): Promise<void> {
  if (place) for (const panel of lobbyDraftPanels(await lobbyViewOf(lobby, api))) await postPanel(place, panel);
  await showLobby(client, lobby, api);
}

// In the lobby's turn, once all finish or time is up: the bans counted and the
// draft dealt.
async function countVote(client: Client, lobby: Lobby, api: ApiClient): Promise<void> {
  // A vote that never opened drafts in the lobby's own channel.
  const place = (await placeOf(client, lobby)) ?? (await sendableIn(client, lobby.channel_id));
  const questions = await questionsOf(lobby, api);
  const messages = lobby.vote?.messages ?? {};
  const live = [VOTE_STATUS, ...votedOn(lobby, questions).map((q) => q.id)].map((key) => messages[key]);
  const read = place ? await reactionsOn(place, live) : new Map<string, Reaction[]>();
  const { ballot, unmatched } = await lobbyBallot(lobby, (key) => read.get(messages[key] ?? '') ?? [], questions, api);
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
  const votes = Object.values(lobby.vote?.messages ?? {});
  unwatchReactions(votes);
  await deleteMessages(place, votes);
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
