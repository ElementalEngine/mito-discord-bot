import type { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';

import { EMOJI_ERROR } from '../config/constants.js';
import type { DraftCommandRequest, VoteDraftRequest } from '../types/draft.js';
import { DraftError } from './draft.service.js';
import { executeDraftMode } from './draftmode.service.js';

export type DraftModeOutput = Readonly<{
  content?: string;
  embeds?: readonly EmbedBuilder[];
  allowedMentions?: Readonly<{ parse: readonly [] }>;
}>;

type VoteDraftingDeps = Readonly<{
  startBlindDraft?: (request: VoteDraftRequest) => Promise<void>;
}>;

export async function executeDraftCommand(
  interaction: ChatInputCommandInteraction,
  request: DraftCommandRequest
): Promise<void> {
  try {
    const payload = await executeDraftMode(request);
    if (!payload) return;
    await interaction.editReply(payload);
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

export async function executeVoteDraft(
  request: VoteDraftRequest,
  deps: VoteDraftingDeps = {}
): Promise<void> {
  try {
    const payload = await executeDraftMode(request, deps);
    if (!payload) return;
    await request.commandChannel.send(payload);
  } catch (err: unknown) {
    const message = err instanceof DraftError ? err.message : 'Draft failed.';
    await request.commandChannel.send({
      content: `${EMOJI_ERROR} ${message}`,
      allowedMentions: { parse: [] as const },
    });
  }
}
