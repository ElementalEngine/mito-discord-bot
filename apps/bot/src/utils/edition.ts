import type { ChatInputCommandInteraction, SlashCommandStringOption } from 'discord.js';

import type { CivVersion } from '../api/types.js';

// Every command that asks which game takes it as one option, `edition`.
export const editionOption = (opt: SlashCommandStringOption): SlashCommandStringOption =>
  opt
    .setName('edition')
    .setDescription('Civ6 or Civ7')
    .setRequired(true)
    .addChoices({ name: 'Civ6', value: 'civ6' }, { name: 'Civ7', value: 'civ7' });

// civ6 reads as Civ6.
export const editionName = (civVersion: string): string => civVersion.replace(/^civ/i, 'Civ');

// CIV7 and civ7 are civ7; anything else is civ6.
export const versionOf = (game: string): CivVersion => (game.toLowerCase() === 'civ7' ? 'civ7' : 'civ6');

export const editionOf = (interaction: ChatInputCommandInteraction): CivVersion => versionOf(interaction.options.getString('edition', true));
