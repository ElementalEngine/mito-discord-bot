import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { randomInt } from 'node:crypto';

import { coinPanel } from '../../ui/panels/misc.js';
import { respond } from '../../ui/reply.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';

export const data = new SlashCommandBuilder()
  .setContexts(InteractionContextType.Guild)
  .setName('coinflip')
  .setDescription('Flip a coin.');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await ensureCommandAccess(interaction))) return;
  await respond(interaction, coinPanel(randomInt(0, 2) === 0 ? 'heads' : 'tails'), 'public');
}
