import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
  type SendableChannels,
} from 'discord.js';

import { config } from '../../config.js';
import { EMOJI_ERROR, EMOJI_FAIL } from '../../config/constants.js';
import { startGameVote } from '../../services/gamevote.service.js';
import type { DraftGameType } from '../../types/draft.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';
import { buildVoiceChannelVoters } from '../../utils/voice-channel-voters.js';

const GAME_TYPES = ['FFA', 'Teamer', 'Duel'] as const;

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

function allowedVoteChannels(gameType: DraftGameType): readonly string[] {
  return gameType === 'Teamer'
    ? [config.discord.channels.civ6teamerVote]
    : [config.discord.channels.civ6ffaVote];
}

export const data = new SlashCommandBuilder()
  .setName('vote-civ6')
  .setDescription('Start a Civ6 game vote in your voice channel, then draft.')
  .setDMPermission(false)
  .addStringOption((opt) =>
    opt
      .setName('game-type')
      .setDescription('FFA, Teamer, or Duel')
      .setRequired(true)
      .addChoices(
        { name: 'FFA', value: 'FFA' },
        { name: 'Teamer', value: 'Teamer' },
        { name: 'Duel', value: 'Duel' }
      )
  )
  .addIntegerOption((opt) =>
    opt
      .setName('number-teams')
      .setDescription('Required for Teamer (2–7).')
      .setMinValue(2)
      .setMaxValue(7)
      .setRequired(false)
  )
  .addBooleanOption((opt) =>
    opt
      .setName('blind-mode')
      .setDescription('If true, voting happens via DM (not allowed for Teamer).')
      .setRequired(false)
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
    const gameTypeRaw = interaction.options.getString('game-type', true);
    if (!GAME_TYPES.includes(gameTypeRaw as (typeof GAME_TYPES)[number])) {
      await replyEphemeral(interaction, `${EMOJI_FAIL} Invalid game-type.`);
      return;
    }
    const gameType = gameTypeRaw as DraftGameType;

    const ACCESS_POLICY = {
      allowedChannelIds: allowedVoteChannels(gameType),
    } as const;
    if (!(await ensureCommandAccess(interaction, ACCESS_POLICY))) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const member = await getMember(interaction);
    if (!member) {
      await replyEphemeral(interaction, `${EMOJI_ERROR} Unable to resolve your member info.`);
      return;
    }

    const voiceChannel = member.voice.channel;
    if (!voiceChannel) {
      await replyEphemeral(
        interaction,
        `${EMOJI_FAIL} Join a voice channel first, then run /vote-civ6.`
      );
      return;
    }

    const numberTeams = interaction.options.getInteger('number-teams') ?? undefined;
    const blindMode = interaction.options.getBoolean('blind-mode') ?? false;
    const mentions = interaction.options.getString('mentions', false);

    if (gameType === 'Teamer' && blindMode) {
      await replyEphemeral(
        interaction,
        `${EMOJI_FAIL} Blind mode is not allowed for **Teamer**.`
      );
      return;
    }

    if (gameType === 'Teamer' && !numberTeams) {
      await replyEphemeral(interaction, `${EMOJI_FAIL} Teamer requires **number-teams**.`);
      return;
    }

    const guild = interaction.guild;
    if (!guild) {
      await replyEphemeral(interaction, `${EMOJI_ERROR} This command must be used in a server.`);
      return;
    }

    const { voters } = await buildVoiceChannelVoters(guild, voiceChannel, mentions);

    // Validate voter counts against draft constraints.
    if (gameType === 'Duel' && voters.length !== 2) {
      await replyEphemeral(
        interaction,
        `${EMOJI_FAIL} Duel requires exactly **2** voters (you have **${voters.length}** after adjustments).`
      );
      return;
    }

    if (gameType === 'FFA' && (voters.length < 2 || voters.length > 14)) {
      await replyEphemeral(
        interaction,
        `${EMOJI_FAIL} Civ6 FFA requires **2–14** voters (you have **${voters.length}** after adjustments).`
      );
      return;
    }

    if (gameType === 'Teamer') {
      const teams = numberTeams ?? 0;
      if (voters.length < 2) {
        await replyEphemeral(interaction, `${EMOJI_FAIL} Teamer requires at least **2** voters.`);
        return;
      }
      if (teams < 2 || teams > 7) {
        await replyEphemeral(interaction, `${EMOJI_FAIL} number-teams must be **2–7**.`);
        return;
      }
      if (voters.length % teams !== 0) {
        await replyEphemeral(
          interaction,
          `${EMOJI_FAIL} Voters (**${voters.length}**) must split evenly across **${teams}** teams.`
        );
        return;
      }
    }

    const channel = interaction.channel;
    if (!channel || !channel.isTextBased() || !('send' in channel)) {
      await replyEphemeral(interaction, `${EMOJI_ERROR} I can't post the vote in this channel.`);
      return;
    }

    const res = await startGameVote({
      guild,
      commandChannel: channel as SendableChannels,
      voiceChannelId: voiceChannel.id,
      host: interaction.user,
      edition: 'CIV6',
      gameType,
      numberTeams,
      blindMode,
      voters,
    });

    if (!res.ok) {
      await replyEphemeral(interaction, res.message);
      return;
    }

    await replyEphemeral(
      interaction,
      `✅ Game vote started (10 minutes).\n` +
        `Voters: **${voters.length}** • Mode: **${gameType}**${blindMode ? ' • Blind (DM)' : ''}`
    );
  } catch (err: unknown) {
    console.error('vote-civ6 failed', {
      err,
      guildId: interaction.guildId ?? null,
      channelId: interaction.channelId,
      userId: interaction.user.id,
    });

    await replyEphemeral(
      interaction,
      `${EMOJI_ERROR} Game vote failed due to an unexpected error.`
    );
  }
}
