import { ModalBuilder, type ButtonInteraction, type ChatInputCommandInteraction, type Interaction, type ModalSubmitInteraction, type StringSelectMenuInteraction } from 'discord.js';

import { ApiClient } from '../api/index.js';
import type { Vote, VoteRequest } from '../api/types.js';
import { civNames, civRows } from '../services/civ-names.js';
import { inLobbyTurn, lobbySettings } from '../services/lobby.service.js';
import { allFinished, allPicked, pickingBy } from '../services/setup.js';
import { advanceVote, postVote, showBlindVoteStatus } from '../services/vote.service.js';
import { customId, parseId } from '../ui/kit/index.js';
import { banFieldIds, banFields } from '../ui/panels/draft.js';
import { VOTE_VERB, voteBlindPickPanel, voteStatusPanel } from '../ui/panels/vote.js';
import { defer, fail, holdPanel, refuse, replacePanel, respond, say } from '../ui/reply.js';
import { selectedIn } from '../utils/modal-fields.js';

const api = new ApiClient();
const BAN_FORM = 'bans';
const FORM_MS = 10 * 60_000;

// A vote waiting on its starter's bans form, by the command that opened it.
const waiting = new Map<string, Readonly<{ request: VoteRequest; until: number }>>();

// What each press does, completing "Could not ...".
const ACTION: Readonly<Record<string, string>> = {
  [VOTE_VERB.finished]: 'finish voting',
  [VOTE_VERB.pick]: 'show your pool',
  [VOTE_VERB.leader]: 'choose your leader',
  [VOTE_VERB.civ]: 'choose your civ',
  [VOTE_VERB.lockIn]: 'lock in your pick',
  [BAN_FORM]: 'start the vote',
};

const actorOf = (interaction: Interaction) => ({ id: interaction.user.id });

// The vote opened and posted in this channel, then the starter told privately.
export async function startVote(interaction: ChatInputCommandInteraction | ModalSubmitInteraction, request: VoteRequest): Promise<void> {
  await defer(interaction, 'private');
  const place = interaction.channel;
  if (!place?.isSendable()) refuse('The vote cannot be posted in this channel.');
  const vote = await api.startVote(request, actorOf(interaction));
  await inLobbyTurn(vote.id, () => postVote(interaction.client, vote, place, api));
  await say(interaction, 'success', `The vote is open below, for ${vote.players.length} players. Its code is ${vote.code}.`);
}

// The starter's bans first, in a form that must be the command's first answer.
export async function openBansForm(interaction: ChatInputCommandInteraction, request: VoteRequest): Promise<void> {
  const scope = { edition: request.edition, age: request.age ?? null };
  const [rows, names] = await Promise.all([civRows(request.edition, api), civNames(request.edition, api)]);
  for (const [key, held] of waiting) if (held.until < Date.now()) waiting.delete(key);
  waiting.set(interaction.id, { request, until: Date.now() + FORM_MS });
  const form = new ModalBuilder()
    .setCustomId(customId('vote', BAN_FORM, interaction.id))
    .setTitle('Bans before the vote')
    .addLabelComponents(...banFields(scope, rows, names));
  await interaction.showModal(form);
}

async function submitBans(interaction: ModalSubmitInteraction, key: string): Promise<void> {
  const held = waiting.get(key);
  waiting.delete(key);
  if (!held || held.until < Date.now()) refuse('This form has expired. Run /vote again.');
  const { request } = held;
  await defer(interaction, 'private');
  const fields = banFieldIds({ edition: request.edition, age: request.age ?? null }, await civRows(request.edition, api));
  await startVote(interaction, { ...request, leader_bans: selectedIn(interaction, fields.leaders), civ_bans: selectedIn(interaction, fields.civs) });
}

// A player is done voting; once every player is, the vote is counted.
async function finishVoting(interaction: ButtonInteraction, voteId: string): Promise<void> {
  await holdPanel(interaction);
  await inLobbyTurn(voteId, async () => {
    const vote = await api.finishVoting(voteId, actorOf(interaction));
    await replacePanel(interaction, voteStatusPanel(vote, await lobbySettings(vote.mode, api, vote.edition)));
    if (allFinished(vote)) await advanceVote(interaction.client, voteId, api, true);
  });
}

const pickingVote = async (voteId: string, playerId: string): Promise<Vote> => pickingBy(await api.vote(voteId), playerId, 'vote');

// A blind drafter's own pool, privately.
async function showPool(interaction: ButtonInteraction, voteId: string): Promise<void> {
  await defer(interaction, 'private');
  const vote = await pickingVote(voteId, interaction.user.id);
  await respond(interaction, voteBlindPickPanel(vote, interaction.user.id, await civNames(vote.edition, api)), 'private');
}

// A leader or civ chosen, the other menu's choice kept; not yet locked in.
async function choose(interaction: StringSelectMenuInteraction, voteId: string, leader: string | undefined, civ: string | undefined): Promise<void> {
  await holdPanel(interaction);
  const vote = await pickingVote(voteId, interaction.user.id);
  await replacePanel(interaction, voteBlindPickPanel(vote, interaction.user.id, await civNames(vote.edition, api), leader, civ));
}

// The pick locked in; once every player has, the picks are revealed.
async function lockIn(interaction: ButtonInteraction, voteId: string, leader: string, civ: string | undefined): Promise<void> {
  await holdPanel(interaction);
  await inLobbyTurn(voteId, async () => {
    const vote = await api.pickInVote(voteId, actorOf(interaction), leader, civ ?? null);
    await replacePanel(interaction, voteBlindPickPanel(vote, interaction.user.id, await civNames(vote.edition, api)));
    await showBlindVoteStatus(interaction.client, vote, api);
    if (allPicked(vote)) await advanceVote(interaction.client, voteId, api, true);
  });
}

export async function handleVoteInteraction(interaction: Interaction): Promise<boolean> {
  if (!(interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit())) return false;
  const id = parseId(interaction.customId);
  if (id?.surface !== 'vote') return false;
  const [voteId = '', first, second] = id.args;
  try {
    if (interaction.isModalSubmit() && id.verb === BAN_FORM) await submitBans(interaction, voteId);
    else if (interaction.isButton() && id.verb === VOTE_VERB.finished) await finishVoting(interaction, voteId);
    else if (interaction.isButton() && id.verb === VOTE_VERB.pick) await showPool(interaction, voteId);
    else if (interaction.isButton() && id.verb === VOTE_VERB.lockIn && first) await lockIn(interaction, voteId, first, second);
    else if (interaction.isStringSelectMenu() && id.verb === VOTE_VERB.leader) await choose(interaction, voteId, interaction.values[0], first);
    else if (interaction.isStringSelectMenu() && id.verb === VOTE_VERB.civ) await choose(interaction, voteId, first, interaction.values[0]);
    else refuse('This is out of date.');
  } catch (error) {
    await fail(interaction, error, ACTION[id.verb] ?? 'take part in the vote', { customId: interaction.customId });
  }
  return true;
}
