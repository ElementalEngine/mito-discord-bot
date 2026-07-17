import { Events } from 'discord.js';
import type { Interaction } from 'discord.js';

import { EMOJI_ERROR, EMOJI_FAIL } from '../../core/config/constants.js';
import { handleDraftingInteraction } from '../../interactions/drafting.interactions.js';
import { handleGameVoteInteraction } from '../../interactions/voting.interactions.js';
import { handleSecretVoteInteraction } from '../../interactions/secretvote.interactions.js';
import { replyEphemeral } from '../../core/discord/index.js';
import { error as logError } from '../../core/logging.js';

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

export async function execute(interaction: Interaction): Promise<void> {
  if (!shouldHandle(interaction.id)) return;

  // Components (buttons / selects / modals)
  if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
    const customId = 'customId' in interaction ? interaction.customId : '';

    try {
      if (await handleSecretVoteInteraction(interaction)) return;
      if (await handleDraftingInteraction(interaction)) return;
      if (await handleGameVoteInteraction(interaction)) return;
    } catch (err) {
      logError('Interaction handler failed', {
        err,
        customId,
        interactionId: interaction.id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        userId: interaction.user.id,
      });
    }
    return;
  }

  // Slash commands
  if (!interaction.isChatInputCommand()) return;

  const command = interaction.client.commands.get(interaction.commandName);
  if (!command) {
    await replyEphemeral(
      interaction,
      `${EMOJI_FAIL} Command not found. The bot may be updating — try again in a moment.`
    );
    return;
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    logError('Command execution failed', {
      err,
      commandName: interaction.commandName,
      interactionId: interaction.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
    });

    await replyEphemeral(
      interaction,
      `${EMOJI_ERROR} Something went wrong while running that command.`
    );
  }
}
