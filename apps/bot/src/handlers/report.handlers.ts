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
import type { Match, SeatEdit } from '../api/types.js';
import { updateRankRolesForApprovedMatch } from '../services/rank-role.service.js';
import { civNames, editionOf } from '../services/civ-names.js';
import {
  deleteReportMessages,
  editorOf,
  historyChannelId,
  memberNames,
  refreshReport,
  viewOf,
} from '../services/report.service.js';
import { channel as channelMention, customId, parseId, type CivNames } from '../ui/kit/index.js';
import {
  EDIT,
  FIELD,
  assignEdits,
  assignForm,
  orderEdits,
  orderForm,
  seatEdits,
  seatForm,
  tieEdits,
  tieForm,
  type Members,
} from '../ui/panels/report-edit.js';
import { playerIds, reportPanel } from '../ui/panels/report.js';
import { defer, editPanel, fail, holdPanel, postPanel, refuse, replacePanel, respond, say } from '../ui/reply.js';
import { isStaff } from '../utils/access.js';
import { log } from '../utils/log.js';
import { logAction } from '../utils/log-command.js';

const api = new ApiClient();
const CONTEST_FORM = 'contestform';
const REASON = 'reason';

// The member picked in a form's user field, if any.
const picked = (interaction: ModalSubmitInteraction, field: string): string | null =>
  interaction.fields.getSelectedUsers(field)?.first()?.id ?? null;

const ACTION: Readonly<Record<string, string>> = {
  approve: 'approve the report',
  contest: 'open the contest form',
  [CONTEST_FORM]: 'record your contest',
  edit: 'open the editor',
  [EDIT.seat]: 'open the seat form',
  [EDIT.seatForm]: 'save the seat',
  [EDIT.order]: 'open the order form',
  [EDIT.orderForm]: 'save the order',
  [EDIT.assign]: 'open the assign form',
  [EDIT.assignForm]: 'save the players',
  [EDIT.tie]: 'open the tie form',
  [EDIT.tieForm]: 'save the tie',
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
  await respond(interaction, await editorOf(interaction.guild, match, staff, api), 'private');
}

// A form from the editor, built from the report as it is now. The members
// were loaded with the editor, so naming them costs no fetch.
async function openForm(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  matchId: string,
  build: (match: Match, names: CivNames, members: Members) => ModalBuilder | null,
): Promise<void> {
  const match = await api.match(matchId);
  const form = build(match, await civNames(editionOf(match.game), api), memberNames(interaction.guild, playerIds(match)));
  if (!form) refuse('The report has changed. Open the editor again.');
  await interaction.showModal(form);
}

// Save, then rewrite the public report and the private editor together, from
// the one saved match, so neither shows anything the other does not.
async function saveSeats(interaction: ModalSubmitInteraction, matchId: string, action: string, seats: readonly SeatEdit[]): Promise<void> {
  const staff = isStaff(interaction);
  const match = await api.editSeats(matchId, seats, { id: interaction.user.id, isStaff: staff });
  const [view, editor] = await Promise.all([viewOf(match, api), editorOf(interaction.guild, match, staff, api)]);
  const [published] = await Promise.all([
    refreshReport(interaction.client, match, reportPanel(view)),
    replacePanel(interaction, editor),
  ]);
  if (!published) await say(interaction, 'failed', 'Saved, but the public report could not be updated.');
  await logAction(interaction, action, { matchId, seats });
}

// Hold the editor, work out the edits from the report as it is now, and save
// them; an empty result is said, not sent.
async function submit(
  interaction: ModalSubmitInteraction,
  matchId: string,
  action: string,
  unchanged: string,
  editsOf: (match: Match) => SeatEdit[],
): Promise<void> {
  await holdPanel(interaction);
  const edits = editsOf(await api.match(matchId));
  if (!edits.length) {
    await say(interaction, 'muted', unchanged);
    return;
  }
  await saveSeats(interaction, matchId, action, edits);
}

const selected = (interaction: ModalSubmitInteraction, field: string): readonly string[] =>
  interaction.fields.getStringSelectValues(field);

export async function handleReportInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isStringSelectMenu()) return false;
  const id = parseId(interaction.customId);
  if (id?.surface !== 'report') return false;
  const matchId = id.args[0] ?? '';
  // A form's page, or for a seat form, the seat number.
  const at = Number(id.args[1] ?? 0);
  try {
    if (interaction.isButton() && id.verb === 'approve') await approve(interaction, matchId);
    else if (interaction.isButton() && id.verb === 'contest') await openContest(interaction, matchId);
    else if (interaction.isModalSubmit() && id.verb === CONTEST_FORM) await submitContest(interaction, matchId);
    else if (interaction.isButton() && id.verb === 'edit') await openEditor(interaction, matchId);
    else if (interaction.isStringSelectMenu() && id.verb === EDIT.seat) {
      await openForm(interaction, matchId, (m, _n, members) => seatForm(m, Number(interaction.values[0]), members));
    } else if (interaction.isButton() && id.verb === EDIT.assign) {
      await openForm(interaction, matchId, (m, names) => assignForm(m, names, at));
    } else if (interaction.isButton() && id.verb === EDIT.order) {
      await openForm(interaction, matchId, (m, names, members) => orderForm(m, names, members, at));
    } else if (interaction.isButton() && id.verb === EDIT.tie) {
      if (!isStaff(interaction)) refuse('Only staff can set a tie.');
      await openForm(interaction, matchId, tieForm);
    } else if (interaction.isModalSubmit() && id.verb === EDIT.seatForm) {
      const choice = {
        player: picked(interaction, FIELD.player),
        quit: interaction.fields.getCheckbox(FIELD.quit),
        left: picked(interaction, FIELD.left),
      };
      await submit(interaction, matchId, 'edit-seat', 'Nothing changed on that seat.', (m) => seatEdits(m, at, choice));
    } else if (interaction.isModalSubmit() && id.verb === EDIT.assignForm) {
      await submit(interaction, matchId, 'assign-players', 'No seat changed.', (m) =>
        assignEdits(m, at, (field) => picked(interaction, field)),
      );
    } else if (interaction.isModalSubmit() && id.verb === EDIT.orderForm) {
      await submit(interaction, matchId, 'set-order', 'The order is unchanged.', (m) => {
        const order = orderEdits(m, at, (field) => selected(interaction, field)[0] ?? null);
        return order.ok ? order.seats : refuse(order.reason);
      });
    } else if (interaction.isModalSubmit() && id.verb === EDIT.tieForm) {
      const place = Number(selected(interaction, FIELD.place)[0]);
      const tied = selected(interaction, FIELD.tied).map(Number);
      await submit(interaction, matchId, 'set-tie', 'Those are already tied there.', (m) => tieEdits(m, place, tied));
    } else {
      await say(interaction, 'refused', 'That control is out of date. Open the report again.');
    }
  } catch (error) {
    await fail(interaction, error, ACTION[id.verb] ?? 'complete that action', { matchId });
  }
  return true;
}
