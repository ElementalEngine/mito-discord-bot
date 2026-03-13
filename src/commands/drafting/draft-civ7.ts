import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';

import { config } from '../../config.js';
import { EMOJI_ERROR } from '../../config/constants.js';
import type { Civ7StartingAge } from '../../data/types.js';
import { executeDraftCommand } from '../../services/drafting.service.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';

function allowedDraftChannels(): readonly string[] {
  return [
    config.discord.channels.botTesting,
    config.discord.channels.civ7Commands,
  ];
}

const ACCESS_POLICY = {
  allowedChannelIds: allowedDraftChannels(),
  requiredRoleIds: [
    config.discord.roles.civ6Rank,
    config.discord.roles.civ7Rank,
    config.discord.roles.civCloud,
  ],
  allowDeveloperOverride: true,
} as const;

const GAME_TYPES = ['FFA', 'Teamer', 'Duel'] as const;
type GameType = (typeof GAME_TYPES)[number];

const STARTING_AGES = ['Antiquity_Age', 'Exploration_Age', 'Modern_Age', 'None'] as const;
type StartingAge = (typeof STARTING_AGES)[number];

const MAX_FFA_PLAYERS = 10;
const MAX_TEAMS = 5;

async function replyError(
  interaction: ChatInputCommandInteraction,
  content: string,
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

function validateDraftCommand(args: Readonly<{
  gameType: GameType;
  numberPlayers?: number;
  numberTeams?: number;
}>): string | null {
  const { gameType, numberPlayers, numberTeams } = args;

  if (gameType === 'FFA') {
    if (numberTeams !== undefined) {
      return `${EMOJI_ERROR} For FFA, use number-players only.`;
    }
    if (numberPlayers === undefined) {
      return `${EMOJI_ERROR} For FFA, number-players is required.`;
    }
    if (numberPlayers > MAX_FFA_PLAYERS) {
      return `${EMOJI_ERROR} Civ7 FFA supports up to ${MAX_FFA_PLAYERS} players.`;
    }
    return null;
  }

  if (gameType === 'Teamer') {
    if (numberPlayers !== undefined) {
      return `${EMOJI_ERROR} For Teamer, use number-teams only.`;
    }
    if (numberTeams === undefined) {
      return `${EMOJI_ERROR} For Teamer, number-teams is required.`;
    }
    if (numberTeams > MAX_TEAMS) {
      return `${EMOJI_ERROR} Civ7 Teamer supports up to ${MAX_TEAMS} teams.`;
    }
    return null;
  }

  if (numberPlayers !== undefined || numberTeams !== undefined) {
    return `${EMOJI_ERROR} Duel is fixed at 2 players. Do not provide number-players or number-teams.`;
  }

  return null;
}

export const data = new SlashCommandBuilder()
  .setName('draft-civ7')
  .setDescription('Generate a Civ 7 standard draft (leaders + civs).')
  .setDMPermission(false)
  .addStringOption((opt) =>
    opt
      .setName('game-type')
      .setDescription('FFA, Teamer, or Duel')
      .setRequired(true)
      .addChoices(
        { name: 'FFA', value: 'FFA' },
        { name: 'Teamer', value: 'Teamer' },
        { name: 'Duel', value: 'Duel' },
      ),
  )
  .addStringOption((opt) =>
    opt
      .setName('starting-age')
      .setDescription('Required Civ7 starting age pool')
      .setRequired(true)
      .addChoices(
        { name: 'Antiquity_Age', value: 'Antiquity_Age' },
        { name: 'Exploration_Age', value: 'Exploration_Age' },
        { name: 'Modern_Age', value: 'Modern_Age' },
        { name: 'None', value: 'None' },
      ),
  )
  .addIntegerOption((opt) =>
    opt
      .setName('number-players')
      .setDescription('Required for FFA only.')
      .setMinValue(2)
      .setMaxValue(MAX_FFA_PLAYERS)
      .setRequired(false),
  )
  .addIntegerOption((opt) =>
    opt
      .setName('number-teams')
      .setDescription('Required for Teamer only.')
      .setMinValue(2)
      .setMaxValue(MAX_TEAMS)
      .setRequired(false),
  )
  .addStringOption((opt) =>
    opt
      .setName('leader-bans')
      .setDescription('Optional. Paste leader emojis separated by commas or new lines.')
      .setRequired(false),
  )
  .addStringOption((opt) =>
    opt
      .setName('civ-bans')
      .setDescription('Optional. Paste civ emojis separated by commas or new lines.')
      .setRequired(false),
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

    const gameType = gameTypeRaw as GameType;
    const numberPlayers = interaction.options.getInteger('number-players') ?? undefined;
    const numberTeams = interaction.options.getInteger('number-teams') ?? undefined;
    const leaderBansRaw = interaction.options.getString('leader-bans') ?? undefined;
    const civBansRaw = interaction.options.getString('civ-bans') ?? undefined;

    const validationError = validateDraftCommand({ gameType, numberPlayers, numberTeams });
    if (validationError) {
      await replyError(interaction, validationError);
      return;
    }

    await interaction.deferReply();

    await executeDraftCommand(interaction, {
      source: 'command',
      edition: 'CIV7',
      draftMode: 'standard',
      gameType,
      startingAge: startingAgeRaw as Civ7StartingAge,
      numberPlayers,
      numberTeams,
      leaderBansRaw,
      civBansRaw,
    });
  } catch (err: unknown) {
    console.error('draftciv7 failed', {
      err,
      guildId: interaction.guildId ?? null,
      channelId: interaction.channelId,
      userId: interaction.user.id,
    });

    await replyError(interaction, `${EMOJI_ERROR} Draft failed due to an unexpected error.`);
  }
}
