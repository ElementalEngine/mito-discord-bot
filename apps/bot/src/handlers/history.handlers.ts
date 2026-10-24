import type { Interaction } from 'discord.js';

import { ApiClient } from '../api/index.js';
import { civNames } from '../services/civ-names.js';
import { parseId } from '../ui/kit/index.js';
import { HISTORY, historyPanel } from '../ui/panels/stats.js';
import { fail, holdPanel, refuse, replacePanel } from '../ui/reply.js';

const api = new ApiClient();

// Older and Newer on a /stats-history panel. Only the member who ran the
// command pages it; anyone else is told to run their own.
export async function handleHistoryInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton()) return false;
  const id = parseId(interaction.customId);
  if (id?.surface !== HISTORY.surface || id.verb !== HISTORY.page) return false;
  try {
    const [edition, mode, target, pageText, asker] = id.args;
    if (!edition || !mode || !target || !asker) refuse('That button is out of date. Run /stats-history again.');
    if (interaction.user.id !== asker) refuse('Run /stats-history to page through games yourself.');
    const civVersion = edition === 'civ7' ? 'civ7' : 'civ6';
    const gameType = mode === 'cloud' ? 'cloud' : 'realtime';
    await holdPanel(interaction);
    const [history, names] = await Promise.all([
      api.getStatsHistory(civVersion, gameType, target, Number(pageText) || 0),
      civNames(civVersion, api),
    ]);
    await replacePanel(interaction, historyPanel(history, { civVersion, mode: gameType, target, asker }, names));
  } catch (error) {
    await fail(interaction, error, 'show those games', { customId: interaction.customId });
  }
  return true;
}
