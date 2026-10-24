import type { RepliableInteraction } from 'discord.js';

import { ApiClient } from '../api/index.js';
import { dealRequest, draftPanels, type DraftChoice } from '../ui/panels/draft.js';
import { respond, respondMore } from '../ui/reply.js';
import { civNames } from './civ-names.js';

// Deal and post a draft to an interaction already deferred in public.
export async function postDraft(
  interaction: RepliableInteraction,
  choice: DraftChoice,
  bans: Readonly<{ leaders: readonly string[]; civs: readonly string[] }>,
  api = new ApiClient(),
): Promise<void> {
  const [deal, names] = await Promise.all([api.dealDraft(dealRequest(choice, bans.leaders, bans.civs)), civNames(choice.edition, api)]);
  const [first, ...rest] = draftPanels({ choice, deal, names, by: interaction.user.id });
  await respond(interaction, first!, 'public');
  for (const panel of rest) await respondMore(interaction, panel);
}
