import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
  type SendableChannels,
  type SlashCommandSubcommandBuilder,
} from 'discord.js';

import { config } from '../../config.js';
import { EMOJI_CONFIRM, EMOJI_ERROR, EMOJI_FAIL } from '../../config/constants.js';
import { startGameVote } from '../../services/voting/orchestration.js';
import { formatBanInputIssues, resolveTypedBanInputForEdition } from '../../services/voting/domain/ban-input.service.js';
import type { DraftGameType } from '../../types/drafting.types.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';
import { buildVoiceChannelVoters } from '../../utils/voice-channel-voters.js';

const SUBCOMMAND_TO_GAME_TYPE = {
  ffa: 'FFA',
  team: 'Teamer',
  duel: 'Duel',
} as const satisfies Record<'ffa' | 'team' | 'duel', DraftGameType>;

type VoteCiv6Subcommand = keyof typeof SUBCOMMAND_TO_GAME_TYPE;

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
  if (gameType === 'Teamer') {
    return [config.discord.channels.civ6teamerVote, config.discord.channels.noviceCommands];
  }

  if (gameType === 'FFA') {
    return [config.discord.channels.civ6ffaVote, config.discord.channels.noviceCommands];
  }

  return [config.discord.channels.civ6ffaVote];
}

function addMentionsOption(subcommand: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return subcommand.addStringOption((opt) =>
    opt
      .setName('mentions')
      .setDescription('Optional: mention users to add/remove from voters')
      .setRequired(false)
  );
}

function addLeaderBansOption(subcommand: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return subcommand.addStringOption((opt) =>
    opt
      .setName('leader-bans')
      .setDescription('Optional: host pre-bans by leader names, IDs, or emoji names')
      .setRequired(false)
  );
}

function addSharedOptions(subcommand: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return addLeaderBansOption(addMentionsOption(subcommand));
}

export const data = new SlashCommandBuilder()
  .setName('vote-civ6')
  .setDescription('Start a Civ6 game vote in your voice channel, then draft.')
  .setDMPermission(false)
  .addSubcommand((subcommand) => addSharedOptions(
    subcommand.setName('ffa').setDescription('Start a Civ6 FFA vote.')
  ))
  .addSubcommand((subcommand) => addSharedOptions(
    subcommand.setName('duel').setDescription('Start a Civ6 duel vote.')
  ))
  .addSubcommand((subcommand) =>
    addSharedOptions(
      subcommand
        .setName('team')
        .setDescription('Start a Civ6 teamer vote.')
        .addIntegerOption((opt) =>
          opt
            .setName('number-of-teams')
            .setDescription('Required for teamer (2–5).')
            .setMinValue(2)
            .setMaxValue(5)
            .setRequired(true)
        )
    )
  );

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  try {
    const subcommand = interaction.options.getSubcommand(true) as VoteCiv6Subcommand;
    const gameType = SUBCOMMAND_TO_GAME_TYPE[subcommand];

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

    const numberTeams =
      subcommand === 'team'
        ? interaction.options.getInteger('number-of-teams', true)
        : undefined;
    const mentions = interaction.options.getString('mentions', false) ?? undefined;
    const hostLeaderBansRaw = interaction.options.getString('leader-bans', false)?.trim() || undefined;

    const hostLeaderBanKeys = (() => {
      if (!hostLeaderBansRaw) return [] as string[];
      const resolved = resolveTypedBanInputForEdition('CIV6', 'leader', hostLeaderBansRaw);
      const issues = formatBanInputIssues(resolved.unknownTokens, resolved.ambiguousTokens);
      if (issues || resolved.keys.length === 0) {
        throw new Error(`HOST_LEADER_BANS:${issues ?? 'No valid leader bans were found.'}`);
      }
      return [...resolved.keys];
    })();

    const guild = interaction.guild;
    if (!guild) {
      await replyEphemeral(interaction, `${EMOJI_ERROR} This command must be used in a server.`);
      return;
    }

    const { voters } = await buildVoiceChannelVoters(guild, voiceChannel, mentions);

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
      if (teams < 2 || teams > 5) {
        await replyEphemeral(interaction, `${EMOJI_FAIL} number-of-teams must be **2–5**.`);
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
      voters,
      hostLeaderBanKeys,
    });

    if (!res.ok) {
      await replyEphemeral(interaction, res.message);
      return;
    }

    await replyEphemeral(
      interaction,
      `${EMOJI_CONFIRM} Vote started • 10 minutes\n` +
        `Voters: **${voters.length}** • Mode: **${gameType}**\n` +
        `Panel: <#${interaction.channelId}>`
    );
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith('HOST_LEADER_BANS:')) {
      await replyEphemeral(interaction, `${EMOJI_FAIL} Invalid host leader-bans.\n${err.message.slice('HOST_LEADER_BANS:'.length)}`);
      return;
    }

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
