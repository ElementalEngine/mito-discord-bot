import type { Client, Message, MessageMentionOptions, SendableChannels } from 'discord.js';

import type { ApiClient } from '../api/index.js';
import type { CivDataResponse, SettingQuestion, Vote, VoteBallot } from '../api/types.js';
import type { CivNames, Panel } from '../ui/kit/index.js';
import { CIV_BANS, LEADER_BANS, VOTE_STATUS, questionPanel, voteBansPanel, voteBlindStatusPanel, voteDraftPanels, voteStatusPanel } from '../ui/panels/vote.js';
import { deleteMessages, editPanel, editPanelById, postPanel } from '../ui/reply.js';
import { log } from '../utils/log.js';
import { civNames, civRows } from './civ-names.js';
import { dropDeadline, isDue, keepDeadline } from './deadlines.js';
import { lobbySettings } from './lobby.service.js';
import { ballotOf, reactionsOn, unwatchReactions, watchReactions, type Reaction } from './reactions.js';

type BanKind = 'leader' | 'civ';

const starterOf = (vote: Vote) => ({ id: vote.host_id });
const playersOf = (vote: Vote): string[] => vote.players.map((p) => p.discord_id);
const questionsOf = (vote: Vote, api: ApiClient): Promise<readonly SettingQuestion[]> => lobbySettings(vote.mode, api, vote.edition);
const banKindsOf = (vote: Vote): [string, BanKind][] => (vote.edition === 'civ7' ? [[LEADER_BANS, 'leader'], [CIV_BANS, 'civ']] : [[LEADER_BANS, 'leader']]);
const plain = (emoji: string): string => emoji.replace(/\uFE0F/g, '');

// Where the vote runs: where its messages were recorded, else where it started.
async function placeOf(client: Client, vote: Vote): Promise<SendableChannels | null> {
  const id = vote.vote.channel_id ?? vote.channel_id;
  const channel = await client.channels.fetch(id).catch(() => null);
  return channel?.isSendable() ? channel : null;
}

// The vote moved on at its deadline, if it has one; any older timer dropped.
function keepVoteTime(client: Client, vote: Vote, api: ApiClient): void {
  keepDeadline(vote.id, vote.status === 'open' ? vote.deadline : null, () => advanceVote(client, vote.id, api));
}

// The players backing each of a setting's options, by its emoji.
function backingOf(question: SettingQuestion, reactions: readonly Reaction[], players: ReadonlySet<string>): Record<string, string[]> {
  const backing: Record<string, string[]> = {};
  for (const reaction of reactions) {
    const option = question.options.find((o) => !reaction.id && plain(o.emoji) === plain(reaction.name ?? ''));
    const voters = reaction.users.filter((u) => players.has(u));
    if (option && voters.length) backing[option.id] = [...new Set([...(backing[option.id] ?? []), ...voters])];
  }
  return backing;
}

const bansOf = (reactions: readonly Reaction[], players: ReadonlySet<string>, kind: BanKind, data: CivDataResponse) =>
  ballotOf(reactions, [...players], kind === 'civ' ? data.civs : data.leaders);

// The reactions so far, sent in the vote's turn as they change: a setting or
// ban a majority backs is won at once and stays won, and its message redrawn.
function watchVote(vote: Vote, data: CivDataResponse, names: CivNames, api: ApiClient) {
  const players = new Set(playersOf(vote));
  let last = vote;
  const count = async (ballot: VoteBallot, redraw: (now: Vote, before: Vote) => Promise<unknown>): Promise<void> => {
    const before = last;
    last = await api.countVoteSoFar(vote.id, starterOf(vote), ballot);
    await redraw(last, before);
  };
  return {
    question: (message: Message, question: SettingQuestion): void =>
      watchReactions(message.id, vote.id, (reactions) =>
        count({ settings: { [question.id]: backingOf(question, reactions, players) }, bans: {} }, async (now, before) => {
          const won = now.settings.find((s) => s.id === question.id);
          if (won && !before.settings.some((s) => s.id === question.id)) await editPanel(message, questionPanel(question, won.value));
        }),
      ),
    bans: (message: Message, kind: BanKind): void =>
      watchReactions(message.id, vote.id, (reactions) =>
        count({ settings: {}, bans: bansOf(reactions, players, kind, data).ballot.bans }, async (now, before) => {
          const landed = (v: Vote) => v.bans.filter((b) => b.kind === kind).length;
          if (landed(now) !== landed(before)) await editPanel(message, voteBansPanel(now, kind, names));
        }),
      ),
  };
}

// The vote posted: status, a message per setting, then bans. Options are added
// as reactions while the next message posts; a vote not posted whole is cancelled.
export async function postVote(client: Client, vote: Vote, place: SendableChannels, api: ApiClient): Promise<Vote> {
  const [questions, names, data] = await Promise.all([questionsOf(vote, api), civNames(vote.edition, api), civRows(vote.edition, api)]);
  const watch = watchVote(vote, data, names, api);
  const posted: Message[] = [];
  const post = async (panel: Panel, pings?: MessageMentionOptions): Promise<Message> => {
    const message = await postPanel(place, panel, pings);
    posted.push(message);
    return message;
  };
  let seeding = Promise.resolve();
  const seed = (message: Message, question: SettingQuestion): void => {
    seeding = seeding
      .then(async () => {
        for (const option of question.options) await message.react(option.emoji);
      })
      .catch((error: unknown) => log.warn('setting reactions not all added', vote.id, error instanceof Error ? error.message : error));
  };
  try {
    const messages: Record<string, string> = { [VOTE_STATUS]: (await post(voteStatusPanel(vote), { users: playersOf(vote) })).id };
    for (const question of questions) {
      const message = await post(questionPanel(question));
      messages[question.id] = message.id;
      watch.question(message, question);
      seed(message, question);
    }
    for (const [key, kind] of banKindsOf(vote)) {
      const message = await post(voteBansPanel(vote, kind, names));
      messages[key] = message.id;
      watch.bans(message, kind);
    }
    const placed = await api.placeVoteMessages(vote.id, starterOf(vote), { channel_id: place.id, messages });
    keepVoteTime(client, placed, api);
    return placed;
  } catch (error) {
    const ids = posted.map((m) => m.id);
    unwatchReactions(ids);
    await deleteMessages(place, ids);
    await api.cancelVote(vote.guild_id, vote.code, starterOf(vote)).catch(() => undefined);
    throw error;
  }
}

// Every reaction read from Discord: per setting, the players backing each
// option by its emoji; per leader or civ, the players banning it.
async function ballotFrom(vote: Vote, place: SendableChannels, questions: readonly SettingQuestion[], api: ApiClient): Promise<VoteBallot> {
  const players = new Set(playersOf(vote));
  const ids = vote.vote.messages;
  const [read, data] = await Promise.all([reactionsOn(place, Object.values(ids)), civRows(vote.edition, api)]);
  const on = (key: string): Reaction[] => read.get(ids[key] ?? '') ?? [];
  const bans = banKindsOf(vote).map(([key, kind]) => bansOf(on(key), players, kind, data));
  const unmatched = bans.flatMap((b) => b.unmatched);
  if (unmatched.length) log.info('ban reactions naming nothing', vote.id, unmatched.join(', '));
  return {
    settings: Object.fromEntries(questions.map((q) => [q.id, backingOf(q, on(q.id), players)])),
    bans: Object.fromEntries(bans.flatMap((b) => Object.entries(b.ballot.bans))),
  };
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

// A counted, drafted or cancelled vote's messages deleted, and no longer
// watched.
export async function closeVoteMessages(client: Client, vote: Vote): Promise<void> {
  const ids = Object.values(vote.vote.messages);
  dropDeadline(vote.id);
  unwatchReactions(ids);
  const place = await placeOf(client, vote);
  if (place) await deleteMessages(place, ids);
}
