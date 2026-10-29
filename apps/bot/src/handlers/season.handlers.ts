import type { Interaction } from 'discord.js';

import { ApiClient } from '../api/index.js';
import { refreshLeaderboards } from '../jobs/update-leaderboard.js';
import { notice, parseId } from '../ui/kit/index.js';
import { SEASON, labelFromId, seasonCancelledPanel, seasonStartedPanel } from '../ui/panels/season.js';
import { fail, holdPanel, refuse, replacePanel } from '../ui/reply.js';
import { isDeveloper } from '../utils/access.js';
import { logAction } from '../utils/log-command.js';

const api = new ApiClient();

// Start and Cancel on a /season-new panel. It is private, so only the developer
// who ran it sees them; the role is checked again on the press.
export async function handleSeasonInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton()) return false;
  const id = parseId(interaction.customId);
  if (id?.surface !== SEASON.surface) return false;
  let started = false;
  try {
    const [edition, label] = id.args;
    if (!edition || !label) refuse('That button is out of date. Run /season-new again.');
    if (!isDeveloper(interaction)) refuse('Only a developer can start a new season.');
    await holdPanel(interaction);
    if (id.verb === SEASON.cancel) {
      await replacePanel(interaction, seasonCancelledPanel());
      return true;
    }
    // The buttons go at once, so a second press has nothing to press.
    await replacePanel(interaction, notice('muted', 'Starting the new season. This takes a few seconds.'));
    started = true;
    const rolled = await api.startNextSeason(edition === 'civ7' ? 'civ7' : 'civ6', labelFromId(label), interaction.user.id);
    refreshLeaderboards(interaction.client, rolled.edition);
    await replacePanel(interaction, seasonStartedPanel(rolled));
    await logAction(interaction, 'season-new', { edition, closed: rolled.closed, opened: rolled.opened, backup: rolled.backup });
  } catch (error) {
    // Whether a failed or lost answer changed the season is not known here.
    if (started) await replacePanel(interaction, notice('failed', 'Run /season-new again to see which season is open.')).catch(() => undefined);
    await fail(interaction, error, 'start the new season', { customId: interaction.customId });
  }
  return true;
}
