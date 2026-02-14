import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
  type SendableChannels,
} from 'discord.js';

import { config } from '../../config.js';
import { EMOJI_ERROR, EMOJI_FAIL } from '../../config/constants.js';
import { startSecretVote } from '../../services/secretvote.service.js';
import type { SecretVoteAction } from '../../types/secretvote.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';
import { buildVoiceChannelVoters } from '../../utils/resolve-voters.js';

const ACCESS_POLICY = {
  allowedChannelIds: [
    config.discord.channels.botTesting,
    config.discord.channels.civ6Commands,
    config.discord.channels.civ7Commands,
    config.discord.channels.cloudCommands,
  ],
} as const;

async function replyEphemeral(
  interaction: ChatInputCommandInteraction,
  content: string
): Promise<void> {
  const base = { content, allowedMentions: { parse: [] as const } } as const;
  try {
    if (interaction.deferred) {
      await interaction.editReply(base);
      return;
    }

    const payload = { ...base, flags: MessageFlags.Ephemeral } as const;
    if (interaction.replied) {
      await interaction.followUp(payload);
      return;
    }
    await interaction.reply(payload);
  } catch {
    // swallow
  }
}

async function getMember(
  interaction: ChatInputCommandInteraction
): Promise<GuildMember | null> {
  if (!interaction.inGuild() || !interaction.guild) return null;
  if (interaction.inCachedGuild()) return interaction.member;
  try {
    return await interaction.guild.members.fetch(interaction.user.id);
  } catch {
    return null;
  }
}

function clampLine(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

export const data = new SlashCommandBuilder()
  .setName('secretvote')
  .setDescription('Start a private YES/NO vote for your voice channel.')
  .setDMPermission(false)
  .addStringOption((opt) =>
    opt
      .setName('action')
      .setDescription('Vote type')
      .setRequired(true)
      .addChoices(
        { name: 'CC', value: 'CC' },
        { name: 'Irrel', value: 'Irrel' },
        { name: 'Remap', value: 'Remap' },
        { name: 'Scrap', value: 'Scrap' }
      )
  )
  .addIntegerOption((opt) =>
    opt
      .setName('turn')
      .setDescription('Turn number')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(9999)
  )
  .addStringOption((opt) =>
    opt
      .setName('details')
      .setDescription('Free-text description (e.g., "cc order: adam, jeff, tim")')
      .setRequired(true)
  )
  .addStringOption((opt) =>
    opt
      .setName('mentions')
      .setDescription('Optional: mention users to add/remove from voters')
      .setRequired(false)
  );

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  try {
    if (!(await ensureCommandAccess(interaction, ACCESS_POLICY))) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const member = await getMember(interaction);
    if (!member) {
      await replyEphemeral(interaction, `${EMOJI_ERROR} Unable to resolve your member info.`);
      return;
    }

    const voiceChannel = member.voice.channel;
    if (!voiceChannel) {
      await replyEphemeral(interaction, `${EMOJI_FAIL} Join a voice channel first, then run /secretvote.`);
      return;
    }

    const action = interaction.options.getString('action', true) as SecretVoteAction;
    const turn = interaction.options.getInteger('turn', true);
    const details = interaction.options.getString('details', true);
    const mentions = interaction.options.getString('mentions', false);

    if (action === 'Remap' && turn > 10) {
      await replyEphemeral(
        interaction,
        `${EMOJI_FAIL} Remap votes can only be requested on or before **turn 10** (you provided turn **${turn}**).`
      );
      return;
    }

    const guild = interaction.guild;
    if (!guild) {
      await replyEphemeral(interaction, `${EMOJI_ERROR} This command must be used in a server.`);
      return;
    }

    const { voters } = await buildVoiceChannelVoters(guild, voiceChannel, mentions);
    if (voters.length < 2) {
      await replyEphemeral(
        interaction,
        `${EMOJI_FAIL} A secret vote requires at least **2** eligible voters.\n` +
          `Current voters: **${voters.length}** (after voice + mention adjustments).`
      );
      return;
    }

    const channel = interaction.channel;
    if (!channel || !channel.isTextBased() || !('send' in channel)) {
      await replyEphemeral(interaction, `${EMOJI_ERROR} I can't post the vote status in this channel.`);
      return;
    }

    const res = await startSecretVote({
      guild,
      commandChannel: channel as SendableChannels,
      voiceChannelId: voiceChannel.id,
      host: interaction.user,
      action,
      turn,
      details,
      voters,
    });

    if (!res.ok) {
      await replyEphemeral(interaction, res.message);
      return;
    }

    const summary = [
      '✅ Secret vote started (2 minutes)',
      `Action: ${action} • Turn: ${turn}`,
      `Details: ${clampLine(details, 800)}`,
      `Started by: <@${interaction.user.id}>`,
      'Voting happens in DMs for each voter.',
      `Status + results: <#${interaction.channelId}> (${res.publicMessageUrl})`,
    ].join('\n');

    await replyEphemeral(interaction, summary);
  } catch (err) {
    console.error('secretvote failed', {
      err,
      guildId: interaction.guildId ?? null,
      channelId: interaction.channelId,
      userId: interaction.user.id,
    });

    await replyEphemeral(interaction, `${EMOJI_ERROR} Secret vote failed due to an unexpected error.`);
  }
}
