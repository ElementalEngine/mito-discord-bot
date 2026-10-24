import type { Interaction } from 'discord.js';

import { ApiClient } from '../api/index.js';
import { civNames, civRows } from '../services/civ-names.js';
import { postDraft } from '../services/draft.service.js';
import { parseId } from '../ui/kit/index.js';
import { BAN_FORM, banMenus, civField, leaderField, unpackChoice } from '../ui/panels/draft.js';
import { defer, fail, refuse } from '../ui/reply.js';

const api = new ApiClient();

// The ban form's answer: its id carries the draft, its fields the bans.
export async function handleDraftInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isModalSubmit() || !interaction.customId.startsWith('draft:')) return false;
  try {
    const id = parseId(interaction.customId);
    const choice = id?.verb === BAN_FORM ? unpackChoice(id.args[0] ?? '') : null;
    if (!choice) refuse('This form is out of date. Run /draft again.');
    const [rows, names] = await Promise.all([civRows(choice.edition, api), civNames(choice.edition, api)]);
    const menus = banMenus(choice, rows, names);
    // A menu left untouched may come back absent rather than empty.
    const picked = (ids: string[]): string[] =>
      ids.flatMap((field) => {
        try {
          return [...interaction.fields.getStringSelectValues(field)];
        } catch {
          return [];
        }
      });
    const bans = {
      leaders: picked(menus.leaders.map((_, i) => leaderField(i))),
      civs: picked(menus.civs.map((_, i) => civField(i))),
    };
    await defer(interaction, 'public');
    await postDraft(interaction, choice, bans, api);
  } catch (error) {
    await fail(interaction, error, 'deal the draft', { customId: interaction.customId });
  }
  return true;
}
