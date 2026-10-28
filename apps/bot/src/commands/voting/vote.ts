import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction, type SlashCommandSubcommandBuilder } from 'discord.js';

import { ApiClient } from '../../api/index.js';
import type { VoteRequest } from '../../api/types.js';
import { config } from '../../config.js';
import { openBansForm, startVote } from '../../handlers/vote.handlers.js';
import { inLobbyTurn } from '../../services/lobby.service.js';
import { closeVoteMessages } from '../../services/vote.service.js';
import { AGE_CHOICES, EVERY_AGE, MODE_CHOICES, editionLabel, type Age, type Edition, type Mode } from '../../ui/panels/draft.js';
import { defer, fail, refuse, say } from '../../ui/reply.js';
import { isStaff } from '../../utils/access.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';

const api = new ApiClient();
const MENTION = /<@!?(\d{17,20})>/g;
const MAX_VOTERS = 14;

function subcommand(sub: SlashCommandSubcommandBuilder, edition: Edition): SlashCommandSubcommandBuilder {
  sub
    .setName(edition)
    .setDescription(`Vote on a ${editionLabel(edition)} game's settings, draft mode and bans with your voice channel.`)
    .addStringOption((o) =>
      o
        .setName('mode')
        .setDescription('Game mode')
        .setRequired(true)
        .addChoices(...MODE_CHOICES),
    );
  if (edition === 'civ7') {
    sub.addStringOption((o) =>
      o
        .setName('age')
        .setDescription('Starting age (default: every age)')
        .addChoices(...AGE_CHOICES),
    );
  }
  return sub
    .addStringOption((o) =>
      o.setName('players').setDescription('Your voice channel is in already. @mention others to add, or to take out, spaced apart').setMaxLength(1000),
    )
    .addBooleanOption((o) => o.setName('bans').setDescription('True: pick bans in a form first'));
}

export const data = new SlashCommandBuilder()
  .setName('vote')
  .setDescription('Vote on a game with your voice channel: settings, draft mode and bans, then the draft.')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) => subcommand(sub, 'civ6'))
  .addSubcommand((sub) => subcommand(sub, 'civ7'))
  .addSubcommand((sub) =>
    sub
      .setName('cancel')
      .setDescription('Cancel a vote: its starter, or staff.')
      .addStringOption((o) => o.setName('code').setDescription("The vote's code").setRequired(true).setMaxLength(8)),
  );

function policyFor(edition: Edition) {
  const c = config.discord.channels;
  return {
    allowedChannelIds: edition === 'civ6' ? [c.botTesting, c.civ6ffaVote, c.civ6teamerVote] : [c.botTesting, c.civ7ffaVote, c.civ7teamerVote],
    requiredRoleIds: [config.discord.roles.civ6Rank, config.discord.roles.civ7Rank, config.discord.roles.civCloud],
    allowDeveloperOverride: true,
  } as const;
}

// The voters: the starter's voice channel, bots aside, with each player
// mentioned added or taken out. A name typed without its mention is refused.
function votersOf(interaction: ChatInputCommandInteraction<'cached'>): string[] {
  const voice = interaction.member.voice.channel;
  if (!voice) refuse('Join a voice channel first: its players are the voters.');
  const voters = new Set([...voice.members.values()].filter((m) => !m.user.bot).map((m) => m.id));
  const mentions = interaction.options.getString('players') ?? '';
  const stray = mentions.replace(MENTION, ' ').replace(/[\s,]+/g, ' ').trim();
  if (stray) refuse(`Pick each player from the @ list so they show as a mention; "${stray.slice(0, 50)}" is not one.`);
  for (const id of new Set([...mentions.matchAll(MENTION)].map((m) => m[1]))) {
    if (id && !voters.delete(id)) voters.add(id);
  }
  if (voters.size < 2 || voters.size > MAX_VOTERS) refuse(`A vote takes 2 to ${MAX_VOTERS} players; this one has ${voters.size}.`);
  return [...voters];
}

function requestOf(interaction: ChatInputCommandInteraction<'cached'>, edition: Edition): VoteRequest {
  const age = interaction.options.getString('age');
  return {
    edition,
    mode: interaction.options.getString('mode', true) as Mode,
    age: edition === 'civ7' && age && age !== EVERY_AGE ? (age as Age) : null,
    guild_id: interaction.guildId,
    channel_id: interaction.channelId,
    players: votersOf(interaction),
    leader_bans: [],
    civ_bans: [],
  };
}

async function cancel(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  await defer(interaction, 'private');
  const code = interaction.options.getString('code', true);
  const cancelled = await api.cancelVote(interaction.guildId, code, { id: interaction.user.id, isStaff: isStaff(interaction) });
  await inLobbyTurn(cancelled.id, async () => closeVoteMessages(interaction.client, await api.vote(cancelled.id)));
  await say(interaction, 'success', `Vote ${cancelled.code} is cancelled.`);
}

const ACTION: Readonly<Record<string, string>> = { civ6: 'start the vote', civ7: 'start the vote', cancel: 'cancel the vote' };

// A vote with bans opens their form first, which must be the command's first
// answer; without, it opens at once.
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand(true);
  try {
    if (!interaction.inCachedGuild()) refuse('Votes are run in a server.');
    if (sub === 'cancel') return await cancel(interaction);
    const edition: Edition = sub === 'civ7' ? 'civ7' : 'civ6';
    if (!(await ensureCommandAccess(interaction, policyFor(edition)))) return;
    const request = requestOf(interaction, edition);
    if (interaction.options.getBoolean('bans')) return await openBansForm(interaction, request);
    await startVote(interaction, request);
  } catch (error) {
    await fail(interaction, error, ACTION[sub] ?? 'run /vote', { command: 'vote' });
  }
}
