import {
  Events,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Interaction,
} from 'discord.js';

import { EMOJI_ERROR, EMOJI_FAIL } from '../config/constants.js';

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

async function safeEphemeral(
  interaction: ChatInputCommandInteraction,
  content: string
): Promise<void> {
  const base = { content, allowedMentions: { parse: [] as const } } as const;

  try {
    if (interaction.deferred) {
      await interaction.editReply(base);
      return;
    }

    const payload = { ...base, flags: MessageFlags.Ephemeral } as const;

    if (interaction.replied) {
      await interaction.followUp(payload);
      return;
    }

    await interaction.reply(payload);
  } catch {

  }
}

export async function execute(interaction: Interaction): Promise<void> {
  if (!shouldHandle(interaction.id)) return;

  // Slash commands
  if (!interaction.isChatInputCommand()) {
    // Buttons / selects / modals are handled here when introduced.
    // Keep this handler lean so interaction logic lives outside event files.
    return;
  }

  const command = interaction.client.commands.get(interaction.commandName);
  if (!command) {
    await safeEphemeral(
      interaction,
      `${EMOJI_FAIL} Command not found. The bot may be updating — try again in a moment.`
    );
    return;
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error('Command execution failed', {
      err,
      commandName: interaction.commandName,
      interactionId: interaction.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
    });

    await safeEphemeral(
      interaction,
      `${EMOJI_ERROR} Something went wrong while running that command.`
    );
  }
}
