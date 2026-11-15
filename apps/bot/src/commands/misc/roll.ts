import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { rollPanel } from '../../ui/panels/misc.js';
import { refuse, respond } from '../../ui/reply.js';
import { drawDistinct, rollDice } from '../../utils/draw.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';
import { postAboutOf, tagPing, withPostOptions } from '../../utils/post-options.js';

const MAX = 100;

export const data = withPostOptions(
  new SlashCommandBuilder()
    .setContexts(InteractionContextType.Guild)
    .setName('roll')
    .setDescription('Roll dice, or draw a turn order with unique.')
    .addIntegerOption((o) => o.setName('count').setDescription('How many dice').setRequired(true).setMinValue(1).setMaxValue(MAX))
    .addIntegerOption((o) => o.setName('sides').setDescription('Sides on each die').setRequired(true).setMinValue(2).setMaxValue(MAX))
    .addBooleanOption((o) => o.setName('unique').setDescription('No repeats: each number once, as for a turn order')),
);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await ensureCommandAccess(interaction))) return;
  const count = interaction.options.getInteger('count', true);
  const sides = interaction.options.getInteger('sides', true);
  const unique = interaction.options.getBoolean('unique') ?? false;
  if (unique && count > sides) refuse(`Cannot draw ${count} different numbers from 1 to ${sides}. Raise sides or lower count.`);
  const drawn = unique ? drawDistinct(count, sides) : rollDice(count, sides);
  const about = postAboutOf(interaction);
  await respond(interaction, rollPanel(drawn, sides, unique, about), 'public', { allowedMentions: tagPing(about) });
}
