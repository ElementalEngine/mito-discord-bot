import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { randomInt } from 'node:crypto';

import { seedPanel } from '../../ui/panels/misc.js';
import { respond } from '../../ui/reply.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';
import { postAboutOf, tagPing, withPostOptions } from '../../utils/post-options.js';

// Civ's map seed is a signed 32-bit integer.
const INT32_MIN = -(2 ** 31);
const INT32_MAX_EXCLUSIVE = 2 ** 31;

export const data = withPostOptions(
  new SlashCommandBuilder().setContexts(InteractionContextType.Guild).setName('mapseed').setDescription('Generate a random Civilization map seed.'),
);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await ensureCommandAccess(interaction))) return;
  const about = postAboutOf(interaction);
  await respond(interaction, seedPanel(String(randomInt(INT32_MIN, INT32_MAX_EXCLUSIVE)), about), 'public', { allowedMentions: tagPing(about) });
}
