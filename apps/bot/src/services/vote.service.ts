import type { Client, Message, MessageMentionOptions, SendableChannels } from 'discord.js';

import type { ApiClient } from '../api/index.js';
import type { CivDataResponse, SettingQuestion, Vote, VoteBallot } from '../api/types.js';
import type { Panel } from '../ui/kit/index.js';
import { VOTE_STATUS } from '../ui/panels/lobby.js';
import { CIV_BANS, LEADER_BANS, questionPanel, voteBansPanel, voteBlindStatusPanel, voteDraftPanels, voteStatusPanel } from '../ui/panels/vote.js';
import { deleteMessages, editPanelById, postPanel } from '../ui/reply.js';
import { log } from '../utils/log.js';
import { civNames, civRows } from './civ-names.js';
import { dropDeadline, isDue, keepDeadline } from './deadlines.js';
import { lobbySettings } from './lobby.service.js';
import { BAN_HINT, ballotOf, reactionsOn, unwatchReactions, watchReactions, type Reaction } from './reactions.js';
import { closeMessages, recorded, sendableIn } from './setup.js';

type BanKind = 'leader' | 'civ';

const starterOf = (vote: Vote) => ({ id: vote.host_id });
const playersOf = (vote: Vote): string[] => vote.players.map((p) => p.discord_id);
const questionsOf = (vote: Vote, api: ApiClient): Promise<readonly SettingQuestion[]> => lobbySettings(vote.mode, api, vote.edition);
const banKindsOf = (vote: Vote): [string, BanKind][] => (vote.edition === 'civ7' ? [[LEADER_BANS, 'leader'], [CIV_BANS, 'civ']] : [[LEADER_BANS, 'leader']]);
const plain = (emoji: string): string => emoji.replace(/\uFE0F/g, '');

// Where the vote runs: where its messages were recorded, else where it started.
const placeOf = (client: Client, vote: Vote): Promise<SendableChannels | null> => sendableIn(client, vote.vote.channel_id ?? vote.channel_id);

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

const landed = (vote: Vote, kind: BanKind): number => vote.bans.filter((b) => b.kind === kind).length;

// The ballot from each message's reactions, by name: per setting not yet won,
// the backers of each option; per ban, from either bans message, its backers.
function voteBallot(vote: Vote, reactionsOf: (key: string) => readonly Reaction[], questions: readonly SettingQuestion[], data: CivDataResponse) {
  const players = new Set(playersOf(vote));
  const open = questions.filter((q) => !vote.settings.some((s) => s.id === q.id));
  const banned = banKindsOf(vote).flatMap(([key]) => reactionsOf(key));
  const bans = ballotOf(banned, [...players], [...data.leaders, ...data.civs]);
  const ballot: VoteBallot = {
    settings: Object.fromEntries(open.map((q) => [q.id, backingOf(q, reactionsOf(q.id), players)])),
    bans: bans.ballot.bans,
  };
  return { ballot, unmatched: bans.unmatched };
}

// The vote posted: status, a message per setting, then bans, each setting's
// options added as reactions while the next posts. One not posted whole is cancelled.
export async function postVote(client: Client, vote: Vote, place: SendableChannels, api: ApiClient): Promise<void> {
  const [questions, names, data] = await Promise.all([questionsOf(vote, api), civNames(vote.edition, api), civRows(vote.edition, api)]);
  const messages: Record<string, string> = {};
  let last = vote;
  let failed = false;
  // The reactions so far, in the vote's turn: a setting a majority wins has its
  // message cleared and shows on the status; a ban that lands shows at once.
  const count = async (byMessage: ReadonlyMap<string, Reaction[]>): Promise<void> => {
    const before = last;
    const { ballot } = voteBallot(before, (key) => byMessage.get(messages[key] ?? '') ?? [], questions, data);
    last = await api.countVoteSoFar(vote.id, starterOf(vote), ballot);
    const won = last.settings.filter((s) => !before.settings.some((b) => b.id === s.id)).map((s) => messages[s.id]);
    if (won.length) {
      unwatchReactions(won);
      await deleteMessages(place, won);
      await editPanelById(place, messages[VOTE_STATUS] ?? '', voteStatusPanel(last, questions));
    }
    for (const [key, kind] of banKindsOf(vote)) {
      if (landed(last, kind) !== landed(before, kind)) await editPanelById(place, messages[key] ?? '', voteBansPanel(last, kind, names));
    }
  };
  const post = async (key: string, panel: Panel, pings?: MessageMentionOptions): Promise<Message> => {
    const message = await postPanel(place, panel, pings);
    messages[key] = message.id;
    if (key !== VOTE_STATUS) watchReactions(vote.id, message.id, count);
    return message;
  };
  let seeding = Promise.resolve();
  const seed = (message: Message, question: SettingQuestion): void => {
    const wanted = (): boolean => !failed && !last.settings.some((s) => s.id === question.id);
    seeding = seeding
      .then(async () => {
        for (const option of question.options) if (wanted()) await message.react(option.emoji);
      })
      .catch((error: unknown) => log.warn('setting reactions not all added', vote.id, error instanceof Error ? error.message : error));
  };
  try {
    await post(VOTE_STATUS, voteStatusPanel(vote, questions), { users: playersOf(vote) });
    // A setting the vote starts with set, such as a host-only one, is not asked.
    for (const question of questions.filter((q) => !vote.settings.some((s) => s.id === q.id))) seed(await post(question.id, questionPanel(question)), question);
    for (const [key, kind] of banKindsOf(vote)) void (await post(key, voteBansPanel(vote, kind, names))).react(BAN_HINT).catch(() => undefined);
    keepVoteTime(client, await api.placeVoteMessages(vote.id, starterOf(vote), { channel_id: place.id, messages }), api);
  } catch (error) {
    failed = true;
    const ids = Object.values(messages);
    unwatchReactions(ids);
    await deleteMessages(place, ids);
    await api.cancelVote(vote.guild_id, vote.code, starterOf(vote)).catch(() => undefined);
    throw error;
  }
}

// Every reaction counted: as they came in where the vote was watched, else
// read from Discord. A setting already won needs none.
async function ballotFrom(vote: Vote, place: SendableChannels, questions: readonly SettingQuestion[], api: ApiClient): Promise<VoteBallot> {
  const { [VOTE_STATUS]: _status, ...ids } = liveMessages(vote);
  const [read, data] = await Promise.all([reactionsOn(place, Object.values(ids)), civRows(vote.edition, api)]);
  const { ballot, unmatched } = voteBallot(vote, (key) => read.get(ids[key] ?? '') ?? [], questions, data);
  if (unmatched.length) log.info('ban reactions naming nothing', vote.id, unmatched.join(', '));
  return ballot;
}

// The vote's messages still up: its status and bans, and settings not yet won.
const liveMessages = (vote: Vote): Record<string, string> =>
  Object.fromEntries(Object.entries(vote.vote.messages).filter(([key]) => !vote.settings.some((s) => s.id === key)));

// The draft posted where the vote was.
async function postVoteDraft(vote: Vote, place: SendableChannels | null, api: ApiClient): Promise<void> {
  if (!place) return;
  const [names, questions] = await Promise.all([civNames(vote.edition, api), questionsOf(vote, api)]);
  for (const panel of voteDraftPanels(vote, names, questions)) await postPanel(place, panel);
}

// In the vote's turn, once all finish or time is up: everything counted and
// the draft dealt. A blind draft's message then replaces the vote's messages.
async function countVote(client: Client, vote: Vote, api: ApiClient): Promise<void> {
  const [place, questions] = await Promise.all([placeOf(client, vote), questionsOf(vote, api)]);
  const ballot = place ? await ballotFrom(vote, place, questions, api) : { settings: {}, bans: {} };
  // A tally that landed but whose answer was lost is read back, so the draft still posts.
  const dealt = await api.tallyVoteBallot(vote.id, starterOf(vote), ballot).catch(async (error: unknown) => {
    const now = await api.vote(vote.id);
    if (now.status === 'open' && now.phase === 'voting') throw error;
    return now;
  });
  await closeVoteMessages(client, vote);
  if (dealt.status === 'cancelled') return;
  if (dealt.phase === 'picking' && place) {
    const status = await postPanel(place, voteBlindStatusPanel(dealt, questions), { users: playersOf(dealt) });
    const placed = await recorded(status, () => api.placeVoteMessages(dealt.id, starterOf(dealt), { channel_id: place.id, messages: { [VOTE_STATUS]: status.id } }));
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

// Who has locked in, on the blind draft's message.
export async function showBlindVoteStatus(client: Client, vote: Vote, api: ApiClient): Promise<void> {
  const [place, questions] = await Promise.all([placeOf(client, vote), questionsOf(vote, api)]);
  const statusId = vote.vote.messages[VOTE_STATUS];
  if (place && statusId) await editPanelById(place, statusId, voteBlindStatusPanel(vote, questions));
}

// A counted, drafted or cancelled vote's messages deleted, and no longer
// watched.
export const closeVoteMessages = (client: Client, vote: Vote): Promise<void> =>
  closeMessages(client, vote.id, vote.vote.channel_id ?? vote.channel_id, Object.values(liveMessages(vote)));
