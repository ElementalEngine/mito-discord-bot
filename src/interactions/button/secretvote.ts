import { MessageFlags, type ButtonInteraction } from 'discord.js';

import { EMOJI_FAIL } from '../../config/constants.js';
import { recordSecretVoteChoice } from '../../services/secretvote.service.js';
import type {
  SecretVoteButtonId,
  SecretVoteChoice,
} from '../../types/secretvote.js';

function parseCustomId(customId: string): SecretVoteButtonId | null {
  // sv:<voteId>:<voterId>:YES|NO
  if (!customId.startsWith('sv:')) return null;
  const parts = customId.split(':');
  if (parts.length !== 4) return null;

  const voteId = parts[1];
  const voterId = parts[2];
  const choice = parts[3] as SecretVoteChoice;

  if (!voteId || !voterId) return null;
  if (choice !== 'YES' && choice !== 'NO') return null;

  return { voteId, voterId, choice };
}

async function replyNotice(
  interaction: ButtonInteraction,
  content: string
): Promise<void> {
  const base = { content, allowedMentions: { parse: [] as const } } as const;

  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(
        interaction.inGuild()
          ? { ...base, flags: MessageFlags.Ephemeral }
          : base
      );
      return;
    }

    await interaction.reply(
      interaction.inGuild() ? { ...base, flags: MessageFlags.Ephemeral } : base
    );
  } catch {
    // ignore
  }
}

export async function handleSecretVoteButton(
  interaction: ButtonInteraction
): Promise<boolean> {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;

  if (interaction.user.id !== parsed.voterId) {
    await replyNotice(interaction, `${EMOJI_FAIL} This vote button isn't for you.`);
    return true;
  }

  const res = await recordSecretVoteChoice(
    parsed.voteId,
    parsed.voterId,
    parsed.choice
  );

  if (!res.ok) {
    // Don't overwrite the DM vote message on errors (prevents conflicting final text).
    await replyNotice(interaction, res.message);
    try {
      if (interaction.message.editable) {
        await interaction.message.edit({
          components: [],
          allowedMentions: { parse: [] as const },
        });
      }
    } catch {
      // ignore
    }
    return true;
  }

  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.update({
        content: `You voted: ${res.choice} ✅ Vote recorded.`,
        components: [],
        allowedMentions: { parse: [] as const },
      });
      return true;
    }
  } catch {
    // fall through
  }

  try {
    if (interaction.message.editable) {
      await interaction.message.edit({
        content: `You voted: ${res.choice} ✅ Vote recorded.`,
        components: [],
        allowedMentions: { parse: [] as const },
      });
      return true;
    }
  } catch {
    // ignore
  }

  await replyNotice(interaction, `You voted: ${res.choice} ✅ Vote recorded.`);
  return true;
}
