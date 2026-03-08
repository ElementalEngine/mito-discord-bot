import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';

import { config } from '../../config.js';
import { EMOJI_ERROR } from '../../config/constants.js';
import type { AgePool } from '../../data/index.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';
import { DraftError, generateCiv7Draft } from '../../services/draft.service.js';
import { buildCiv7DraftEmbed } from '../../ui/embeds/draft.js';

const ACCESS_POLICY = {
  allowedChannelIds: [
    config.discord.channels.botTesting,
    config.discord.channels.civ6Commands,
    config.discord.channels.civ7Commands,
    config.discord.channels.cloudCommands,
  ],
  requiredRoleIds: [
    config.discord.roles.civ6Rank,
    config.discord.roles.civ7Rank,
    config.discord.roles.civCloud,
  ],
  allowDeveloperOverride: true,
} as const;

const GAME_TYPES = ['FFA', 'Teamer', 'Duel'] as const;
type GameType = (typeof GAME_TYPES)[number];

const STARTING_AGES = ['Antiquity_Age', 'Exploration_Age', 'Modern_Age'] as const;
type StartingAge = (typeof STARTING_AGES)[number];

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
    // swallow: interaction may already be acknowledged/expired
  }
}

export const data = new SlashCommandBuilder()
  .setName('draftciv7')
  .setDescription('Generate a Civ 7 draft (leaders + civs).')
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
  .addStringOption((opt) =>
    opt
      .setName('starting-age')
      .setDescription('Required Civ7 starting age pool')
      .setRequired(true)
      .addChoices(
        { name: 'Antiquity_Age', value: 'Antiquity_Age' },
        { name: 'Exploration_Age', value: 'Exploration_Age' },
        { name: 'Modern_Age', value: 'Modern_Age' }
      )
  )
  .addIntegerOption((opt) =>
    opt
      .setName('number-players')
      .setDescription('Required for FFA (2–10). Do not use for Teamer/Duel.')
      .setMinValue(2)
      .setMaxValue(10)
      .setRequired(false)
  )
  .addIntegerOption((opt) =>
    opt
      .setName('number-teams')
      .setDescription('Required for Teamer (2–5). Do not use for FFA/Duel.')
      .setMinValue(2)
      .setMaxValue(5)
      .setRequired(false)
  )
  .addStringOption((opt) =>
    opt
      .setName('leader-bans')
      .setDescription('Optional. Paste leader emojis separated by commas.')
      .setRequired(false)
  )
  .addStringOption((opt) =>
    opt
      .setName('civ-bans')
      .setDescription('Optional. Paste civ emojis separated by commas.')
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    if (!(await ensureCommandAccess(interaction, ACCESS_POLICY))) return;

    const gameTypeRaw = interaction.options.getString('game-type', true);
    if (!GAME_TYPES.includes(gameTypeRaw as GameType)) {
      await replyError(interaction, `${EMOJI_ERROR} Invalid game-type.`);
      return;
    }

    const startingAgeRaw = interaction.options.getString('starting-age', true);
    if (!STARTING_AGES.includes(startingAgeRaw as StartingAge)) {
      await replyError(interaction, `${EMOJI_ERROR} Invalid starting-age.`);
      return;
    }

    const numberPlayers = interaction.options.getInteger('number-players') ?? undefined;
    const numberTeams = interaction.options.getInteger('number-teams') ?? undefined;
    const leaderBansRaw = interaction.options.getString('leader-bans') ?? undefined;
    const civBansRaw = interaction.options.getString('civ-bans') ?? undefined;

    await interaction.deferReply();

    const draft = generateCiv7Draft({
      gameType: gameTypeRaw as GameType,
      startingAge: startingAgeRaw as AgePool,
      numberPlayers,
      numberTeams,
      leaderBansRaw,
      civBansRaw,
    });

    const embed = buildCiv7DraftEmbed(draft);

    await interaction.editReply({ embeds: [embed] });
  } catch (err: unknown) {
    if (err instanceof DraftError) {
      await replyError(interaction, `${EMOJI_ERROR} ${err.message}`);
      return;
    }

    console.error('draftciv7 failed', {
      err,
      guildId: interaction.guildId ?? null,
      channelId: interaction.channelId,
      userId: interaction.user.id,
    });

    await replyError(interaction, `${EMOJI_ERROR} Draft failed due to an unexpected error.`);
  }
}