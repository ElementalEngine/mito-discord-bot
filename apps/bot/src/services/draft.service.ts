import type { RepliableInteraction } from 'discord.js';

import { ApiClient } from '../api/index.js';
import { dealRequest, draftPanels, type DraftChoice, type DraftSettings } from '../ui/panels/draft.js';
import { respond, respondMore } from '../ui/reply.js';
import { log } from '../utils/log.js';
import { civNames } from './civ-names.js';

let settings: DraftSettings | null = null;

// core-api's settings questions, read once at startup: /draft's options are
// built from them. When they cannot be read, Discord keeps the command it has.
export async function readDraftSettings(api = new ApiClient()): Promise<DraftSettings | null> {
  try {
    const [civ6, civ7] = await Promise.all([api.getDraftSettings('civ6'), api.getDraftSettings('civ7')]);
    settings = { civ6, civ7 };
  } catch (error) {
    log.warn('draft settings unavailable', error instanceof Error ? error.message : error);
  }
  return settings;
}

export const draftSettings = (): DraftSettings | null => settings;

// Deal and post a draft to an interaction already deferred in public.
export async function postDraft(
  interaction: RepliableInteraction,
  choice: DraftChoice,
  rules: string | null,
  bans: Readonly<{ leaders: readonly string[]; civs: readonly string[] }>,
  api = new ApiClient(),
): Promise<void> {
  const [deal, names] = await Promise.all([api.dealDraft(dealRequest(choice, bans.leaders, bans.civs)), civNames(choice.edition, api)]);
  const questions = settings?.[choice.edition] ?? [];
  const [first, ...rest] = draftPanels({ choice, rules, questions, deal, names, by: interaction.user.id });
  await respond(interaction, first!, 'public');
  for (const panel of rest) await respondMore(interaction, panel);
}
