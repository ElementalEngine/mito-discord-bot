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

export const editionOf = (interaction: ChatInputCommandInteraction): CivVersion =>
  interaction.options.getString('edition', true) === 'civ7' ? 'civ7' : 'civ6';
