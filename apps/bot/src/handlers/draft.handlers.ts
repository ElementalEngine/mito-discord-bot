import type { Interaction } from 'discord.js';

import { ApiClient } from '../api/index.js';
import { civNames, civRows } from '../services/civ-names.js';
import { postDraft } from '../services/draft.service.js';
import { parseId } from '../ui/kit/index.js';
import { BAN_FORM, LABEL_FIELD, banMenus, civField, leaderField, unpackForm } from '../ui/panels/draft.js';
import { defer, fail, refuse } from '../ui/reply.js';

const api = new ApiClient();

// A field left untouched may come back absent rather than empty.
function read<T>(get: () => T, empty: T): T {
  try {
    return get();
  } catch {
    return empty;
  }
}

// The ban form's answer: its id carries the draft and who and where it is
// for, its fields the bans and the label.
export async function handleDraftInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isModalSubmit() || !interaction.customId.startsWith('draft:')) return false;
  try {
    const id = parseId(interaction.customId);
    const form = id?.verb === BAN_FORM ? unpackForm(id.args, read(() => interaction.fields.getTextInputValue(LABEL_FIELD), '')) : null;
    if (!form) refuse('This form is out of date. Run /draft again.');
    const { choice, about } = form;
    const [rows, names] = await Promise.all([civRows(choice.edition, api), civNames(choice.edition, api)]);
    const menus = banMenus(choice, rows, names);
    const picked = (ids: string[]): string[] => ids.flatMap((field) => read(() => [...interaction.fields.getStringSelectValues(field)], []));
    const bans = {
      leaders: picked(menus.leaders.map((_, i) => leaderField(i))),
      civs: picked(menus.civs.map((_, i) => civField(i))),
    };
    await defer(interaction, 'public');
    await postDraft(interaction, choice, bans, about, api);
  } catch (error) {
    await fail(interaction, error, 'deal the draft', { customId: interaction.customId });
  }
  return true;
}
