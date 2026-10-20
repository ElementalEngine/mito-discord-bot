import type { ChatInputCommandInteraction } from 'discord.js';

import { EMOJI_ERROR } from '../../config/constants.js';
import type { DraftCommandRequest } from '../../types/drafting.types.js';
import type { DraftMessagePayload, DraftModeOutput } from '../../types/drafting.types.js';
import { DraftError } from './draft.service.js';
import { runStandardDraftMode } from './modes/standard.js';

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
    const { initial, followUps } = normalizeOutput(runStandardDraftMode(request));
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
