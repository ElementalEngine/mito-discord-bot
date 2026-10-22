import {
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Interaction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';

import { ApiClient } from '../api/index.js';
import type { SeatEdit } from '../api/types.js';
import { updateRankRolesForApprovedMatch } from '../services/rank-role.service.js';
import { civNames, editionOf } from '../services/civ-names.js';
import { deleteReportMessages, historyChannelId, refreshReport, viewOf } from '../services/report.service.js';
import { channel as channelMention, customId, parseId } from '../ui/kit/index.js';
import { EDIT, FIELD, editorPanel, orderForm, parseOrder, seatEdit, seatForm } from '../ui/panels/report-edit.js';
import { playerIds, reportPanel } from '../ui/panels/report.js';
import { defer, editPanel, fail, holdPanel, postPanel, refuse, replacePanel, respond, say } from '../ui/reply.js';
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
  edit: 'open the editor',
  [EDIT.seat]: 'open the seat form',
  [EDIT.seatForm]: 'save the seat',
  [EDIT.order]: 'open the order form',
  [EDIT.orderForm]: 'save the order',
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

// The editor is the reporter's or staff's; core-api checks the reporter
// again on every save, and only staff may set a tie.
async function openEditor(interaction: ButtonInteraction, matchId: string): Promise<void> {
  await defer(interaction, 'private');
  const match = await api.match(matchId);
  const staff = isStaff(interaction);
  if (!staff && match.reporter_discord_id !== interaction.user.id) refuse('Only the reporter or staff can edit this report.');
  const names = await civNames(editionOf(match.game), api);
  await respond(interaction, editorPanel(match, names, staff), 'private');
}

async function openSeatForm(interaction: StringSelectMenuInteraction, matchId: string): Promise<void> {
  const form = seatForm(await api.match(matchId), Number(interaction.values[0]));
  if (!form) refuse('That seat is no longer on the report. Open the editor again.');
  await interaction.showModal(form);
}

async function openOrderForm(interaction: ButtonInteraction, matchId: string): Promise<void> {
  const match = await api.match(matchId);
  await interaction.showModal(orderForm(match, await civNames(editionOf(match.game), api)));
}

// Save, then rewrite the public report and the private editor together.
async function saveSeats(interaction: ModalSubmitInteraction, matchId: string, action: string, seats: readonly SeatEdit[]): Promise<void> {
  const staff = isStaff(interaction);
  const match = await api.editSeats(matchId, seats, { id: interaction.user.id, isStaff: staff });
  await refreshReport(interaction.client, match, api);
  await replacePanel(interaction, editorPanel(match, await civNames(editionOf(match.game), api), staff));
  await logAction(interaction, action, { matchId, seats });
}

async function submitSeat(interaction: ModalSubmitInteraction, matchId: string, index: number): Promise<void> {
  await holdPanel(interaction);
  const users = (field: string): string | null => interaction.fields.getSelectedUsers(field)?.first()?.id ?? null;
  const edit = seatEdit(await api.match(matchId), index, {
    player: users(FIELD.player),
    quit: interaction.fields.getCheckbox(FIELD.quit),
    left: users(FIELD.left),
  });
  if (!edit) {
    await say(interaction, 'muted', 'Nothing changed on that seat.');
    return;
  }
  await saveSeats(interaction, matchId, 'edit-seat', [edit]);
}

async function submitOrder(interaction: ModalSubmitInteraction, matchId: string): Promise<void> {
  await holdPanel(interaction);
  const order = parseOrder(await api.match(matchId), interaction.fields.getTextInputValue(FIELD.order));
  if (!order.ok) refuse(order.reason);
  await saveSeats(interaction, matchId, 'set-order', order.seats);
}

export async function handleReportInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isStringSelectMenu()) return false;
  const id = parseId(interaction.customId);
  if (id?.surface !== 'report') return false;
  const matchId = id.args[0] ?? '';
  try {
    if (interaction.isButton() && id.verb === 'approve') await approve(interaction, matchId);
    else if (interaction.isButton() && id.verb === 'contest') await openContest(interaction, matchId);
    else if (interaction.isModalSubmit() && id.verb === CONTEST_FORM) await submitContest(interaction, matchId);
    else if (interaction.isButton() && id.verb === 'edit') await openEditor(interaction, matchId);
    else if (interaction.isStringSelectMenu() && id.verb === EDIT.seat) await openSeatForm(interaction, matchId);
    else if (interaction.isButton() && id.verb === EDIT.order) await openOrderForm(interaction, matchId);
    else if (interaction.isModalSubmit() && id.verb === EDIT.seatForm) await submitSeat(interaction, matchId, Number(id.args[1]));
    else if (interaction.isModalSubmit() && id.verb === EDIT.orderForm) await submitOrder(interaction, matchId);
    else await say(interaction, 'refused', 'That control is out of date. Open the report again.');
  } catch (error) {
    await fail(interaction, error, ACTION[id.verb] ?? 'complete that action', { matchId });
  }
  return true;
}
