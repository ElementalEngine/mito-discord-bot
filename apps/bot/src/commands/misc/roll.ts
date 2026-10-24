import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { rollPanel } from '../../ui/panels/misc.js';
import { refuse, respond } from '../../ui/reply.js';
import { drawDistinct } from '../../utils/draw.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';
import { POST_POLICY, postAboutOf, tagPing, withPostOptions } from '../../utils/post-options.js';

const MAX = 100;

export const data = withPostOptions(
  new SlashCommandBuilder()
    .setContexts(InteractionContextType.Guild)
    .setName('roll')
    .setDescription('Draw distinct numbers: a turn order, or picks from a range.')
    .addIntegerOption((o) => o.setName('count').setDescription('How many numbers').setRequired(true).setMinValue(1).setMaxValue(MAX))
    .addIntegerOption((o) => o.setName('max').setDescription('Highest number; leave empty for a turn order of count').setMinValue(1).setMaxValue(MAX)),
);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await ensureCommandAccess(interaction, POST_POLICY))) return;
  const count = interaction.options.getInteger('count', true);
  const max = interaction.options.getInteger('max') ?? count;
  if (count > max) refuse(`Cannot draw ${count} different numbers from 1 to ${max}. Raise max or lower count.`);
  const about = postAboutOf(interaction);
  await respond(interaction, rollPanel(drawDistinct(count, max), max, about), 'public', { allowedMentions: tagPing(about) });
}
