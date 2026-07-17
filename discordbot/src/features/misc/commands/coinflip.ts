import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { randomInt } from 'node:crypto';

import { config } from '../../../core/config/index.js';
import { EMOJI_QUESTION } from '../../../core/config/constants.js';
import { ensureCommandAccess } from '../../../core/discord/index.js';

export const data = new SlashCommandBuilder()
  .setName('coinflip')
  .setDescription('Flip a coin.');

const ACCESS_POLICY = {
  allowedChannelIds: [
    config.discord.channels.botTesting,
    config.discord.channels.civ6Commands,
    config.discord.channels.civ7Commands,
    config.discord.channels.cloudCommands,
    config.discord.channels.noviceCommands,
  ],
  requiredRoleIds: [
    config.discord.roles.civ6Rank,
    config.discord.roles.civ7Rank,
    config.discord.roles.civCloud,
  ],
  allowDeveloperOverride: true,
} as const;

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const ok = await ensureCommandAccess(interaction, ACCESS_POLICY);
  if (!ok) return;

  const result = randomInt(0, 2) === 0 ? 'Heads' : 'Tails';
  const embed = new EmbedBuilder()
    .setTitle(`${EMOJI_QUESTION} Coin Flip`)
    .setDescription(`The coin landed on **${result}**!`)
    .setColor(0x00ff00);

  await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}
