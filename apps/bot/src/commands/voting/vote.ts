import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction, type SlashCommandSubcommandBuilder } from 'discord.js';

import { ApiClient } from '../../api/index.js';
import type { CivVersion, VoteRequest } from '../../api/types.js';
import { config } from '../../config.js';
import type { Mode } from '../../config/constants.js';
import { openBansForm, startVote } from '../../handlers/vote.handlers.js';
import { inSetupTurn } from '../../services/turns.js';
import { closeVoteMessages } from '../../services/vote.service.js';
import { AGE_CHOICES, EVERY_AGE, MODE_CHOICES, type Age } from '../../ui/panels/draft.js';
import { defer, fail, refuse, say } from '../../ui/reply.js';
import { isStaff } from '../../utils/access.js';
import { editionName, versionOf } from '../../utils/edition.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';
import { playersOption, votersOf } from '../../utils/voters.js';

const api = new ApiClient();

function subcommand(sub: SlashCommandSubcommandBuilder, edition: CivVersion): SlashCommandSubcommandBuilder {
  sub
    .setName(edition)
    .setDescription(`Vote on a ${editionName(edition)} game's settings, draft mode and bans with your voice channel.`)
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
        .setDescription('Starting age, or All')
        .setRequired(true)
        .addChoices(...AGE_CHOICES),
    );
  }
  return sub
    .addStringOption(playersOption)
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

function channelsFor(edition: CivVersion): string[] {
  const c = config.discord.channels;
  return edition === 'civ6' ? [c.botTesting, c.civ6ffaVote, c.civ6teamerVote] : [c.botTesting, c.civ7ffaVote, c.civ7teamerVote];
}

function requestOf(interaction: ChatInputCommandInteraction<'cached'>, edition: CivVersion): VoteRequest {
  const age = interaction.options.getString('age');
  return {
    edition,
    mode: interaction.options.getString('mode', true) as Mode,
    age: edition === 'civ7' && age && age !== EVERY_AGE ? (age as Age) : null,
    guild_id: interaction.guildId,
    channel_id: interaction.channelId,
    players: votersOf(interaction).voters,
    leader_bans: [],
    civ_bans: [],
  };
}

async function cancel(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  await defer(interaction, 'private');
  const code = interaction.options.getString('code', true);
  const cancelled = await api.cancelVote(interaction.guildId, code, { id: interaction.user.id, isStaff: isStaff(interaction) });
  await inSetupTurn(cancelled.id, async () => closeVoteMessages(interaction.client, await api.vote(cancelled.id)));
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
    const edition = versionOf(sub);
    if (!(await ensureCommandAccess(interaction, channelsFor(edition)))) return;
    const request = requestOf(interaction, edition);
    if (interaction.options.getBoolean('bans')) return await openBansForm(interaction, request);
    await startVote(interaction, request);
  } catch (error) {
    await fail(interaction, error, ACTION[sub] ?? 'run /vote', { command: 'vote' });
  }
}
