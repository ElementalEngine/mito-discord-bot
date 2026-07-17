import type { ChatInputCommandInteraction } from 'discord.js';

import { EMOJI_ERROR } from '../../config/constants.js';
import type { DraftCommandRequest, VoteDraftRequest } from '../../types/drafting.types.js';
import type { DraftMessagePayload, DraftModeOutput } from '../../types/drafting.types.js';
import { DraftError } from './draft.service.js';
import { executeDraftMode } from './mode-registry.service.js';

function normalizeOutput(output: DraftModeOutput): Readonly<{
  initial: DraftMessagePayload;
  followUps: readonly DraftMessagePayload[];
}> {
  const { followUps = [], ...initial } = output;
  return { initial, followUps };
}

export async function executeDraftCommand(
  interaction: ChatInputCommandInteraction,
  request: DraftCommandRequest,
): Promise<void> {
  try {
    const output = await executeDraftMode(request);
    if (!output) return;

    const { initial, followUps } = normalizeOutput(output);
    await interaction.editReply(initial);

    for (const payload of followUps) {
      await interaction.followUp(payload);
    }
  } catch (err: unknown) {
    if (err instanceof DraftError) {
      await interaction.editReply({
        content: `${EMOJI_ERROR} ${err.message}`,
        embeds: [],
      });
      return;
    }
    throw err;
  }
}

export async function executeVoteDraft(request: VoteDraftRequest): Promise<void> {
  try {
    const output = await executeDraftMode(request);
    if (!output) return;

    const { initial, followUps } = normalizeOutput(output);
    await request.commandChannel.send(initial);

    for (const payload of followUps) {
      await request.commandChannel.send(payload);
    }
  } catch (err: unknown) {
    const message = err instanceof DraftError ? err.message : 'Draft failed.';
    await request.commandChannel.send({
      content: `${EMOJI_ERROR} ${message}`,
      allowedMentions: { parse: [] as const },
    });
  }
}
