import type { Interaction } from 'discord.js';

import { ApiClient } from '../api/index.js';
import { civRows } from '../services/civ-names.js';
import { postDraft } from '../services/draft.service.js';
import { parseId } from '../ui/kit/index.js';
import { BAN_FORM, LABEL_FIELD, banFieldIds, unpackForm } from '../ui/panels/draft.js';
import { defer, fail, refuse } from '../ui/reply.js';
import { selectedIn, typedIn } from '../utils/modal-fields.js';

const api = new ApiClient();

// The ban form's answer: its id carries the draft and who and where it is
// for, its fields the bans and the label.
export async function handleDraftInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isModalSubmit() || !interaction.customId.startsWith('draft:')) return false;
  try {
    const id = parseId(interaction.customId);
    const form = id?.verb === BAN_FORM ? unpackForm(id.args, typedIn(interaction, LABEL_FIELD)) : null;
    if (!form) refuse('This form is out of date. Run /draft again.');
    const { choice, about } = form;
    const fields = banFieldIds(choice, await civRows(choice.edition, api));
    const bans = { leaders: selectedIn(interaction, fields.leaders), civs: selectedIn(interaction, fields.civs) };
    await defer(interaction, 'public');
    await postDraft(interaction, choice, bans, about, api);
  } catch (error) {
    await fail(interaction, error, 'deal the draft', { customId: interaction.customId });
  }
  return true;
}
