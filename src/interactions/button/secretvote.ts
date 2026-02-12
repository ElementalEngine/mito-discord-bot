import {
  MessageFlags,
  type ButtonInteraction,
  type InteractionReplyOptions,
} from 'discord.js';

import { EMOJI_FAIL } from '../../config/constants.js';
import { recordSecretVoteChoice } from '../../services/secretvote.service.js';
import type { SecretVoteButtonId, SecretVoteChoice } from '../../types/secretvote.js';

export function parseSecretVoteCustomId(
  customId: string
): SecretVoteButtonId | null {
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

async function safeUpdateOrReply(
  interaction: ButtonInteraction,
  payload: { content: string; components?: [] }
): Promise<void> {
  const base = {
    content: payload.content,
    components: payload.components ?? ([] as const),
    allowedMentions: { parse: [] as const },
  } as const;

  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.update(base);
      return;
    }
  } catch {
    // fall through
  }

  const withFlags: InteractionReplyOptions = interaction.inGuild()
    ? { ...base, flags: MessageFlags.Ephemeral }
    : base;

  try {
    if (interaction.deferred) {
      await interaction.editReply(base);
      return;
    }

    if (interaction.replied) {
      await interaction.followUp(withFlags);
      return;
    }

    await interaction.reply(withFlags);
  } catch {
    // ignore
  }
}

export async function handleSecretVoteButton(
  interaction: ButtonInteraction
): Promise<boolean> {
  const parsed = parseSecretVoteCustomId(interaction.customId);
  if (!parsed) return false;

  if (interaction.user.id !== parsed.voterId) {
    await safeUpdateOrReply(interaction, {
      content: `${EMOJI_FAIL} This vote button isn't for you.`,
      components: [],
    });
    return true;
  }

  const res = await recordSecretVoteChoice(
    parsed.voteId,
    parsed.voterId,
    parsed.choice
  );

  if (!res.ok) {
    await safeUpdateOrReply(interaction, {
      content: res.message,
      components: [],
    });
    return true;
  }

  const content = res.isComplete
    ? '✅ Vote recorded. Vote ended.'
    : '✅ Vote recorded. Thanks!';

  await safeUpdateOrReply(interaction, { content, components: [] });

  return true;
}
