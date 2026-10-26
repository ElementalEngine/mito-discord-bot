import { Events, type Interaction } from 'discord.js';

import { handleDraftInteraction } from '../handlers/draft.handlers.js';
import { handleReportInteraction } from '../handlers/report.handlers.js';
import { handleRoomsInteraction } from '../handlers/rooms.handlers.js';
import { handleHistoryInteraction } from '../handlers/history.handlers.js';
import { handleSeasonInteraction } from '../handlers/season.handlers.js';
import { handleSecretVoteInteraction } from '../interactions/secretvote.interactions.js';
import { defer, fail, say } from '../ui/reply.js';

export const name = Events.InteractionCreate;
export const once = false;

const seen = new Map<string, number>();
const TTL_MS = 2 * 60_000;
let lastSweep = 0;

function shouldHandle(interactionId: string): boolean {
  const now = Date.now();
  const prev = seen.get(interactionId);
  if (prev && now - prev < TTL_MS) return false;

  seen.set(interactionId, now);

  if (now - lastSweep > 30_000 && seen.size > 200) {
    for (const [id, ts] of seen) {
      if (now - ts > TTL_MS) seen.delete(id);
    }
    lastSweep = now;
  }

  return true;
}

// Every failure, from a command or a component, is answered the same way:
// logged once, and told privately to the person who acted.
export async function execute(interaction: Interaction): Promise<void> {
  if (!shouldHandle(interaction.id)) return;

  if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isUserSelectMenu() || interaction.isModalSubmit()) {
    try {
      if (await handleDraftInteraction(interaction)) return;
      if (await handleReportInteraction(interaction)) return;
      if (await handleSecretVoteInteraction(interaction)) return;
      if (await handleHistoryInteraction(interaction)) return;
      if (await handleRoomsInteraction(interaction)) return;
      if (await handleSeasonInteraction(interaction)) return;
    } catch (error) {
      await fail(interaction, error, 'complete that action', { customId: interaction.customId });
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = interaction.client.commands.get(interaction.commandName);
  if (!command) {
    await say(interaction, 'refused', 'That command is not available right now. Try again in a moment.');
    return;
  }

  try {
    if (command.visibility) await defer(interaction, command.visibility);
    await command.execute(interaction);
  } catch (error) {
    await fail(interaction, error, `run /${interaction.commandName}`, { command: interaction.commandName });
  }
}
