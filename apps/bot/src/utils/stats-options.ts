import type { ChatInputCommandInteraction, SlashCommandBuilder, SlashCommandStringOption } from 'discord.js';

import type { CivVersion, StatsGameType } from '../api/types.js';
import { config } from '../config.js';
import { editionOf, editionOption } from './edition.js';

const STATS_CHANNELS = [
  config.discord.channels.botTesting,
  config.discord.channels.civ6Commands,
  config.discord.channels.civ7Commands,
  config.discord.channels.cloudCommands,
  config.discord.channels.noviceCommands,
];

// core-api's cap on players in one stats or team request.
export const MAX_PLAYERS = 200;

export const STATS_POLICY = {
  allowedChannelIds: STATS_CHANNELS,
  requiredRoleIds: [config.discord.roles.civ6Rank, config.discord.roles.civ7Rank, config.discord.roles.civCloud],
  allowDeveloperOverride: true,
} as const;

export const modeOption = (opt: SlashCommandStringOption): SlashCommandStringOption =>
  opt
    .setName('mode')
    .setDescription('realtime or cloud')
    .setRequired(true)
    .addChoices({ name: 'realtime', value: 'realtime' }, { name: 'cloud', value: 'cloud' });

export const modeOf = (interaction: ChatInputCommandInteraction): StatsGameType =>
  interaction.options.getString('mode', true) === 'cloud' ? 'cloud' : 'realtime';

// The options /stats and /stats-history share: which game, which mode, whose.
export function withStatsOptions(builder: SlashCommandBuilder, whose: string): SlashCommandBuilder {
  builder
    .addStringOption(editionOption)
    .addStringOption(modeOption)
    .addUserOption((opt) => opt.setName('user').setDescription(whose).setRequired(false));
  return builder;
}

export type StatsAsk = Readonly<{ civVersion: CivVersion; mode: StatsGameType; target: string }>;

export function statsAskOf(interaction: ChatInputCommandInteraction): StatsAsk {
  return {
    civVersion: editionOf(interaction),
    mode: modeOf(interaction),
    target: (interaction.options.getUser('user') ?? interaction.user).id,
  };
}
