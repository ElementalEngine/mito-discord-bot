import type { RepliableInteraction } from 'discord.js';

import { config } from '../config.js';
import { channel as channelMention, fit, mention, text } from '../ui/kit/index.js';
import { postPanel } from '../ui/reply.js';
import { log } from './log.js';

// One line per reporting action in the report-log channel, where staff can
// search it. Never throws: the action it records has already happened.
export async function logAction(
  interaction: RepliableInteraction,
  action: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const where = config.discord.channels.reportLogChannel;
  const target = await interaction.client.channels.fetch(where).catch(() => null);
  if (!target?.isSendable()) {
    log.warn('report log channel unavailable', where, action, details);
    return;
  }
  const line = `\`${action}\` by ${mention(interaction.user.id)} in ${channelMention(interaction.channelId ?? '')}`;
  const body = [text(line), text(`\`\`\`json\n${fit(JSON.stringify(details), 1500)}\n\`\`\``)];
  await postPanel(target, { tone: 'muted', body }).catch((error: unknown) => {
    log.warn('report log not posted', error instanceof Error ? error.message : error);
  });
}

