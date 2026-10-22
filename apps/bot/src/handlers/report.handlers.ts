import {
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Interaction,
  type ModalSubmitInteraction,
} from 'discord.js';

import { ApiClient } from '../api/index.js';
import { updateRankRolesForApprovedMatch } from '../services/rank-role.service.js';
import { deleteReportMessages, historyChannelId, viewOf } from '../services/report.service.js';
import { channel as channelMention, customId, parseId } from '../ui/kit/index.js';
import { playerIds, reportPanel } from '../ui/panels/report.js';
import { defer, editPanel, fail, postPanel, refuse, say } from '../ui/reply.js';
import { isStaff } from '../utils/access.js';
import { log } from '../utils/log.js';
import { logAction } from '../utils/log-command.js';

const api = new ApiClient();
const CONTEST_FORM = 'contestform';
const REASON = 'reason';

const ACTION: Readonly<Record<string, string>> = {
  approve: 'approve the report',
  contest: 'open the contest form',
  [CONTEST_FORM]: 'record your contest',
  edit: 'edit the report',
};

// Approve is staff only. Once core-api has rated the match, posting to history
// and clearing the uploads queue are best effort; without history it stays.
async function approve(interaction: ButtonInteraction, matchId: string): Promise<void> {
  if (!isStaff(interaction)) refuse('Only staff can approve a report.');
  await defer(interaction, 'private');
  const match = await api.approve(matchId, { id: interaction.user.id, isStaff: true });
  const view = await viewOf(match, api);
  const history = await interaction.client.channels.fetch(historyChannelId(match)).catch(() => null);
  const posted = history?.isSendable()
    ? await postPanel(history, reportPanel(view), { users: playerIds(match) }).then(
        () => true,
        (error: unknown) => {
          log.warn('approved result not posted', matchId, error instanceof Error ? error.message : error);
          return false;
        },
      )
    : false;
  if (posted) await deleteReportMessages(interaction.client, match);
  else await editPanel(interaction.message, reportPanel(view)).catch(() => undefined);
  if (interaction.guild && match.affected_players?.length) {
    await updateRankRolesForApprovedMatch(interaction.guild, match.affected_players).catch((error: unknown) => {
      log.warn('rank roles not synced', matchId, error instanceof Error ? error.message : error);
    });
  }
  const where = posted ? `The result is in ${channelMention(historyChannelId(match))}.` : 'The result stays on the report.';
  await say(interaction, 'success', `Approved. ${where}`);
  await logAction(interaction, 'approve', { matchId });
}

// Contest is for the match's own players. The form opens only for them, so
// nobody writes a reason that is then refused.
async function openContest(interaction: ButtonInteraction, matchId: string): Promise<void> {
  const match = await api.match(matchId);
  if (!playerIds(match).includes(interaction.user.id)) refuse('Only players in this match can contest it.');
  const reason = new TextInputBuilder()
    .setCustomId(REASON)
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(5)
    .setMaxLength(500)
    .setRequired(true);
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(customId('report', CONTEST_FORM, matchId))
      .setTitle('Contest this report')
      .addLabelComponents(
        new LabelBuilder()
          .setLabel('What is wrong with it?')
          .setDescription('Staff read this before they approve.')
          .setTextInputComponent(reason),
      ),
  );
}

async function submitContest(interaction: ModalSubmitInteraction, matchId: string): Promise<void> {
  await defer(interaction, 'private');
  const reason = interaction.fields.getTextInputValue(REASON).trim();
  const match = await api.contest(matchId, reason, { id: interaction.user.id });
  if (interaction.message) await editPanel(interaction.message, reportPanel(await viewOf(match, api)));
  await say(interaction, 'success', 'Your contest is on the report. Staff see it before they approve.');
  await logAction(interaction, 'contest', { matchId, reason });
}

export async function handleReportInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() && !interaction.isModalSubmit()) return false;
  const id = parseId(interaction.customId);
  if (id?.surface !== 'report') return false;
  const matchId = id.args[0] ?? '';
  try {
    if (interaction.isButton() && id.verb === 'approve') await approve(interaction, matchId);
    else if (interaction.isButton() && id.verb === 'contest') await openContest(interaction, matchId);
    else if (interaction.isModalSubmit() && id.verb === CONTEST_FORM) await submitContest(interaction, matchId);
    else await say(interaction, 'muted', 'Editing from the report is not switched on yet.');
  } catch (error) {
    await fail(interaction, error, ACTION[id.verb] ?? 'complete that action', { matchId });
  }
  return true;
}
