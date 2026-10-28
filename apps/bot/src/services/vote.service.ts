import type { Client, Message, MessageMentionOptions, SendableChannels } from 'discord.js';

import type { ApiClient } from '../api/index.js';
import type { CivDataResponse, SettingQuestion, Vote, VoteBallot } from '../api/types.js';
import { CIV_BANS, LEADER_BANS, VOTE_STATUS, questionPanel, voteBansPanel, voteBlindStatusPanel, voteDraftPanels, voteStatusPanel } from '../ui/panels/vote.js';
import type { Panel } from '../ui/kit/index.js';
import { editPanelById, postPanel } from '../ui/reply.js';
import { log } from '../utils/log.js';
import { civNames, civRows } from './civ-names.js';
import { dropDeadline, isDue, keepDeadline } from './deadlines.js';
import { lobbySettings } from './lobby.service.js';
import { ballotOf, reactionsOn, unwatchBans, watchBans } from './reactions.js';

const starterOf = (vote: Vote) => ({ id: vote.host_id });
const playersOf = (vote: Vote): string[] => vote.players.map((p) => p.discord_id);
const questionsOf = (vote: Vote, api: ApiClient): Promise<readonly SettingQuestion[]> => lobbySettings(vote.mode, api, vote.edition);
const plain = (emoji: string): string => emoji.replace(/️/g, '');

// Where the vote runs: where its messages were recorded, else where it started.
async function placeOf(client: Client, vote: Vote): Promise<SendableChannels | null> {
  const id = vote.vote.channel_id ?? vote.channel_id;
  const channel = await client.channels.fetch(id).catch(() => null);
  return channel?.isSendable() ? channel : null;
}

async function deleteMessages(place: SendableChannels, ids: readonly (string | undefined)[]): Promise<void> {
  for (const id of ids) if (id) await place.messages.delete(id).catch(() => undefined);
}

// The vote moved on at its deadline, if it has one; any older timer dropped.
function keepVoteTime(client: Client, vote: Vote, api: ApiClient): void {
  keepDeadline(vote.id, vote.status === 'open' ? vote.deadline : null, () => advanceVote(client, vote.id, api));
}

// The bans so far, sent in the vote's turn as reactions change; the bans
// message is redrawn when one lands. A ban once landed stays.
function watchVoteBans(client: Client, vote: Vote, messageId: string, kind: 'leader' | 'civ', data: CivDataResponse, api: ApiClient): void {
  let landed = vote.bans.length;
  watchBans(messageId, vote.id, async (reactions) => {
    const { ballot } = ballotOf(reactions, playersOf(vote), kind === 'civ' ? data.civs : data.leaders);
    const counted = await api.countVoteBans(vote.id, starterOf(vote), ballot);
    if (counted.bans.length === landed) return;
    landed = counted.bans.length;
    const place = await placeOf(client, counted);
    if (place) await editPanelById(place, messageId, voteBansPanel(counted, kind, await civNames(vote.edition, api)));
  });
}

// Each setting's options added as reactions, so players need only click. It
// runs outside the vote's turn: players may vote while it is still adding.
async function seedReactions(messages: readonly [Message, SettingQuestion][]): Promise<void> {
  for (const [message, question] of messages) {
    for (const option of question.options) await message.react(option.emoji);
  }
}

// The vote posted where it was started: its status, a message per setting,
// then the bans. One that cannot be posted whole is taken down and cancelled.
export async function postVote(client: Client, vote: Vote, place: SendableChannels, api: ApiClient): Promise<Vote> {
  const [questions, names, data] = await Promise.all([questionsOf(vote, api), civNames(vote.edition, api), civRows(vote.edition, api)]);
  const posted: Message[] = [];
  const post = async (panel: Panel, pings?: MessageMentionOptions): Promise<Message> => {
    const message = await postPanel(place, panel, pings);
    posted.push(message);
    return message;
  };
  try {
    const status = await post(voteStatusPanel(vote), { users: playersOf(vote) });
    const asked: [Message, SettingQuestion][] = [];
    for (const question of questions) asked.push([await post(questionPanel(question)), question]);
    const leaders = await post(voteBansPanel(vote, 'leader', names));
    const civs = vote.edition === 'civ7' ? await post(voteBansPanel(vote, 'civ', names)) : null;
    const messages = {
      [VOTE_STATUS]: status.id,
      ...Object.fromEntries(asked.map(([message, question]) => [question.id, message.id])),
      [LEADER_BANS]: leaders.id,
      ...(civs ? { [CIV_BANS]: civs.id } : {}),
    };
    const placed = await api.placeVoteMessages(vote.id, starterOf(vote), { channel_id: place.id, messages });
    watchVoteBans(client, placed, leaders.id, 'leader', data, api);
    if (civs) watchVoteBans(client, placed, civs.id, 'civ', data, api);
    keepVoteTime(client, placed, api);
    void seedReactions(asked).catch((error: unknown) => log.warn('setting reactions not all added', vote.id, error instanceof Error ? error.message : error));
    return placed;
  } catch (error) {
    for (const message of posted) await message.delete().catch(() => undefined);
    await api.cancelVote(vote.guild_id, vote.code, starterOf(vote)).catch(() => undefined);
    throw error;
  }
}

// Every reaction read from Discord: per setting, the players backing each
// option by its emoji; per leader or civ, the players banning it.
async function ballotFrom(vote: Vote, place: SendableChannels, questions: readonly SettingQuestion[], api: ApiClient): Promise<VoteBallot> {
  const players = new Set(playersOf(vote));
  const settings: Record<string, Record<string, string[]>> = {};
  for (const question of questions) {
    const backing: Record<string, string[]> = {};
    for (const reaction of await reactionsOn(place, vote.vote.messages[question.id])) {
      const option = question.options.find((o) => !reaction.id && plain(o.emoji) === plain(reaction.name ?? ''));
      const voters = reaction.users.filter((u) => players.has(u));
      if (option && voters.length) backing[option.id] = [...new Set([...(backing[option.id] ?? []), ...voters])];
    }
    settings[question.id] = backing;
  }
  const data = await civRows(vote.edition, api);
  const leaders = ballotOf(await reactionsOn(place, vote.vote.messages[LEADER_BANS]), [...players], data.leaders);
  const civs = ballotOf(await reactionsOn(place, vote.vote.messages[CIV_BANS]), [...players], data.civs);
  const unmatched = [...leaders.unmatched, ...civs.unmatched];
  if (unmatched.length) log.info('ban reactions naming nothing', vote.id, unmatched.join(', '));
  return { settings, bans: { ...leaders.ballot.bans, ...civs.ballot.bans } };
}

// The draft posted where the vote was.
async function postVoteDraft(vote: Vote, place: SendableChannels | null, api: ApiClient): Promise<void> {
  if (!place) return;
  const [names, questions] = await Promise.all([civNames(vote.edition, api), questionsOf(vote, api)]);
  for (const panel of voteDraftPanels(vote, names, questions)) await postPanel(place, panel);
}

// In the vote's turn, once all finish or time is up: everything counted and
// the draft dealt. A blind draft's message then replaces the vote's messages.
async function countVote(client: Client, vote: Vote, api: ApiClient): Promise<void> {
  const place = await placeOf(client, vote);
  const ballot = place ? await ballotFrom(vote, place, await questionsOf(vote, api), api) : { settings: {}, bans: {} };
  // A tally that landed but whose answer was lost is read back, so the draft still posts.
  const dealt = await api.tallyVoteBallot(vote.id, starterOf(vote), ballot).catch(async (error: unknown) => {
    const now = await api.vote(vote.id);
    if (now.status === 'open' && now.phase === 'voting') throw error;
    return now;
  });
  await closeVoteMessages(client, vote);
  if (dealt.status === 'cancelled') return;
  if (dealt.phase === 'picking' && place) {
    const status = await postPanel(place, voteBlindStatusPanel(dealt), { users: playersOf(dealt) });
    const placed = await api.placeVoteMessages(dealt.id, starterOf(dealt), { channel_id: place.id, messages: { [VOTE_STATUS]: status.id } }).catch(async (error: unknown) => {
      await status.delete().catch(() => undefined);
      throw error;
    });
    return keepVoteTime(client, placed, api);
  }
  if (dealt.phase === 'picking') return revealVotePicks(client, dealt, api);
  await postVoteDraft(dealt, place, api);
}

// The blind picks revealed together, in the vote's turn.
async function revealVotePicks(client: Client, vote: Vote, api: ApiClient): Promise<void> {
  const shown = await api.revealVotePicks(vote.id, starterOf(vote));
  await closeVoteMessages(client, vote);
  await postVoteDraft(shown, await placeOf(client, shown), api);
}

// In the vote's turn, the step that is due: the vote counted or the blind picks
// revealed; either ends early once every player is done.
export async function advanceVote(client: Client, voteId: string, api: ApiClient, allDone = false): Promise<void> {
  const vote = await api.vote(voteId);
  if (vote.status !== 'open' || !(isDue(vote.deadline) || allDone)) return;
  dropDeadline(voteId);
  if (vote.phase === 'voting') return countVote(client, vote, api);
  return revealVotePicks(client, vote, api);
}

// Who has finished, or locked in, on the vote's status message.
export async function showVoteStatus(client: Client, vote: Vote): Promise<void> {
  const place = await placeOf(client, vote);
  const statusId = vote.vote.messages[VOTE_STATUS];
  if (place && statusId) await editPanelById(place, statusId, vote.phase === 'picking' ? voteBlindStatusPanel(vote) : voteStatusPanel(vote));
}

// A counted, drafted or cancelled vote's messages deleted, and its bans no
// longer watched.
export async function closeVoteMessages(client: Client, vote: Vote): Promise<void> {
  const ids = Object.values(vote.vote.messages);
  dropDeadline(vote.id);
  unwatchBans(ids);
  const place = await placeOf(client, vote);
  if (place) await deleteMessages(place, ids);
}
