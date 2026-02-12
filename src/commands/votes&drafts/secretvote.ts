import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
  type SendableChannels,
} from 'discord.js';

import { config } from '../../config.js';
import { EMOJI_ERROR, EMOJI_FAIL } from '../../config/constants.js';
import type { SecretVoteAction } from '../../types/secretvote.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';
import { buildVoiceChannelVoterList } from '../../utils/resolve-voters.js';
import { startSecretVote } from '../../services/secretvote.service.js';

const ACCESS_POLICY = {
  allowedChannelIds: [
    config.discord.channels.botTesting,
    config.discord.channels.civ6Commands,
    config.discord.channels.civ7Commands,
    config.discord.channels.cloudCommands,
  ],
} as const;

async function replyError(
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
    // ignore
  }
}

async function getGuildMember(
  interaction: ChatInputCommandInteraction
): Promise<GuildMember | null> {
  if (!interaction.inGuild()) return null;

  if (interaction.inCachedGuild()) return interaction.member;

  const guild = interaction.guild;
  if (!guild) return null;

  try {
    return await guild.members.fetch(interaction.user.id);
  } catch {
    return null;
  }
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
  if (!(await ensureCommandAccess(interaction, ACCESS_POLICY))) return;

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch {
    // if already acknowledged, keep going; replyError will handle fallback
  }

  const guild = interaction.guild;
  if (!interaction.inGuild() || !guild) {
    await replyError(interaction, `${EMOJI_FAIL} This command must be used in a server.`);
    return;
  }

  const member = await getGuildMember(interaction);
  if (!member) {
    await replyError(interaction, `${EMOJI_ERROR} Unable to resolve your server member info.`);
    return;
  }

  const voiceChannel = member.voice.channel;
  if (!voiceChannel) {
    await replyError(interaction, `${EMOJI_FAIL} Join a voice channel first, then run /secretvote.`);
    return;
  }

  const action = interaction.options.getString('action', true) as SecretVoteAction;
  const turn = interaction.options.getInteger('turn', true);
  const details = interaction.options.getString('details', true);
  const mentionsRaw = interaction.options.getString('mentions', false);
  const { voters } = await buildVoiceChannelVoterList(guild, voiceChannel, mentionsRaw);

  if (voters.length === 0) {
    await replyError(interaction, `${EMOJI_FAIL} No eligible voters found (voice channel has no non-bot users).`);
    return;
  }

  const channel = interaction.channel;
  if (!channel || !channel.isTextBased() || !('send' in channel)) {
    await replyError(interaction, `${EMOJI_ERROR} Cannot post vote in this channel.`);
    return;
  }

  const res = await startSecretVote({
    guild: guild,
    commandChannel: channel as SendableChannels,
    voiceChannelId: voiceChannel.id,
    host: interaction.user,
    action,
    turn,
    details,
    voters,
  });

  if (!res.ok) {
    await replyError(interaction, res.message);
    return;
  }

  await replyError(
    interaction,
    `✅ Secret vote started. Check your DMs to vote.\nPublic vote: ${res.publicMessageUrl}`
  );
}
