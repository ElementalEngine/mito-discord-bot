import type { RepliableInteraction } from 'discord.js';

import { ApiClient } from '../api/index.js';
import { draftPanels, draftRequest, type DraftBans, type DraftChoice } from '../ui/panels/draft.js';
import { respond, respondMore } from '../ui/reply.js';
import { tagPing, type PostAbout } from '../utils/post-options.js';
import { civNames } from './civ-names.js';

// Deal and post a draft to an interaction already deferred in public.
export async function postDraft(
  interaction: RepliableInteraction,
  choice: DraftChoice,
  bans: DraftBans,
  about: PostAbout,
  api = new ApiClient(),
): Promise<void> {
  const [deal, names] = await Promise.all([api.dealDraft(draftRequest(choice, bans, interaction.user.id)), civNames(choice.edition, api)]);
  const [first, ...rest] = draftPanels({ choice, deal, names, by: interaction.user.id, about });
  await respond(interaction, first!, 'public', { allowedMentions: tagPing(about) });
  for (const panel of rest) await respondMore(interaction, panel);
}
