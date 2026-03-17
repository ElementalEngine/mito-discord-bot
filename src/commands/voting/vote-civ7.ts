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
import type { Civ7StartingAge } from '../../data/types.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';
import { buildVoiceChannelVoters } from '../../utils/voice-channel-voters.js';

const SUBCOMMAND_TO_GAME_TYPE = {
  ffa: 'FFA',
  team: 'Teamer',
  duel: 'Duel',
} as const satisfies Record<'ffa' | 'team' | 'duel', DraftGameType>;
const STARTING_AGES = [
  'Antiquity_Age',
  'Exploration_Age',
  'Modern_Age',
  'None',
] as const;

type VoteCiv7Subcommand = keyof typeof SUBCOMMAND_TO_GAME_TYPE;

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
    ? [config.discord.channels.civ7teamerVote]
    : [config.discord.channels.civ7ffaVote];
}

function addStartingAgeOption(subcommand: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return subcommand.addStringOption((opt) =>
    opt
      .setName('starting-age')
      .setDescription('Required Civ7 starting age pool')
      .setRequired(true)
      .addChoices(
        { name: 'Antiquity_Age', value: 'Antiquity_Age' },
        { name: 'Exploration_Age', value: 'Exploration_Age' },
        { name: 'Modern_Age', value: 'Modern_Age' },
        { name: 'None', value: 'None' }
      )
  );
}

function addMentionsOption(subcommand: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return subcommand.addStringOption((opt) =>
    opt
      .setName('mentions')
      .setDescription('Optional: mention users to add/remove from voters')
      .setRequired(false)
  );
}

function addHostBanOptions(subcommand: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return subcommand
    .addStringOption((opt) =>
      opt
        .setName('leader-bans')
        .setDescription('Optional: host pre-bans by leader names, IDs, or emoji names')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('civ-bans')
        .setDescription('Optional: host pre-bans by civ names, IDs, or emoji names')
        .setRequired(false)
    );
}

function addSharedOptions(subcommand: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return addHostBanOptions(addMentionsOption(addStartingAgeOption(subcommand)));
}

export const data = new SlashCommandBuilder()
  .setName('vote-civ7')
  .setDescription('Start a Civ7 game vote in your voice channel, then draft.')
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    addSharedOptions(subcommand.setName('ffa').setDescription('Start a Civ7 FFA vote.'))
  )
  .addSubcommand((subcommand) =>
    addSharedOptions(subcommand.setName('duel').setDescription('Start a Civ7 duel vote.'))
  )
  .addSubcommand((subcommand) =>
    addSharedOptions(
      subcommand
        .setName('team')
        .setDescription('Start a Civ7 teamer vote.')
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
    const subcommand = interaction.options.getSubcommand(true) as VoteCiv7Subcommand;
    const gameType = SUBCOMMAND_TO_GAME_TYPE[subcommand];

    const startingAgeRaw = interaction.options.getString('starting-age', true);
    if (!STARTING_AGES.includes(startingAgeRaw as (typeof STARTING_AGES)[number])) {
      await replyEphemeral(interaction, `${EMOJI_FAIL} Invalid starting-age.`);
      return;
    }
    const startingAge = startingAgeRaw as Civ7StartingAge;

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
        `${EMOJI_FAIL} Join a voice channel first, then run /vote-civ7.`
      );
      return;
    }

    const numberTeams =
      subcommand === 'team'
        ? interaction.options.getInteger('number-of-teams', true)
        : undefined;
    const mentions = interaction.options.getString('mentions', false) ?? undefined;
    const hostLeaderBansRaw = interaction.options.getString('leader-bans', false)?.trim() || undefined;
    const hostCivBansRaw = interaction.options.getString('civ-bans', false)?.trim() || undefined;

    const hostLeaderBanKeys = (() => {
      if (!hostLeaderBansRaw) return [] as string[];
      const resolved = resolveTypedBanInputForEdition('CIV7', 'leader', hostLeaderBansRaw);
      const issues = formatBanInputIssues(resolved.unknownTokens, resolved.ambiguousTokens);
      if (issues || resolved.keys.length === 0) {
        throw new Error(`HOST_LEADER_BANS:${issues ?? 'No valid leader bans were found.'}`);
      }
      return [...resolved.keys];
    })();

    const hostCivBanKeys = (() => {
      if (!hostCivBansRaw) return [] as string[];
      const resolved = resolveTypedBanInputForEdition('CIV7', 'civ', hostCivBansRaw);
      const issues = formatBanInputIssues(resolved.unknownTokens, resolved.ambiguousTokens);
      if (issues || resolved.keys.length === 0) {
        throw new Error(`HOST_CIV_BANS:${issues ?? 'No valid civ bans were found.'}`);
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

    if (gameType === 'FFA' && (voters.length < 2 || voters.length > 10)) {
      await replyEphemeral(
        interaction,
        `${EMOJI_FAIL} Civ7 FFA requires **2–10** voters (you have **${voters.length}** after adjustments).`
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
      edition: 'CIV7',
      gameType,
      startingAge,
      numberTeams,
      voters,
      hostLeaderBanKeys,
      hostCivBanKeys,
    });

    if (!res.ok) {
      await replyEphemeral(interaction, res.message);
      return;
    }

    await replyEphemeral(
      interaction,
      `${EMOJI_CONFIRM} Vote started • 10 minutes\n` +
        `Voters: **${voters.length}** • Mode: **${gameType}** • Age: **${startingAge}**\n` +
        `Panel: <#${interaction.channelId}>`
    );
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith('HOST_LEADER_BANS:')) {
      await replyEphemeral(interaction, `${EMOJI_FAIL} Invalid host leader-bans.\n${err.message.slice('HOST_LEADER_BANS:'.length)}`);
      return;
    }
    if (err instanceof Error && err.message.startsWith('HOST_CIV_BANS:')) {
      await replyEphemeral(interaction, `${EMOJI_FAIL} Invalid host civ-bans.\n${err.message.slice('HOST_CIV_BANS:'.length)}`);
      return;
    }

    console.error('vote-civ7 failed', {
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
