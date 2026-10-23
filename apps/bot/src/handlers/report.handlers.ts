import {
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type AnySelectMenuInteraction,
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
import { channel as channelMention, customId, mention, parseId, type CivNames, type Panel } from '../ui/kit/index.js';
import {
  EDIT,
  FIELD,
  assignPanel,
  civFocus,
  civPickEdit,
  civsPanel,
  closedEditor,
  draftEdits,
  EDITOR_CLOSED,
  orderPanel,
  quitEdits,
  quitsForm,
  seatEdits,
  seatForm,
  tieEdits,
  tieForm,
  withAssignPick,
  withOrderPick,
  type Members,
} from '../ui/panels/report-edit.js';
import { playerIds, reportPanel } from '../ui/panels/report.js';
import { Refusal, defer, editPanel, fail, holdPanel, postPanel, refuse, replacePanel, respond, say } from '../ui/reply.js';
import { isAdminOrDeveloper, isStaff } from '../utils/access.js';
import { idleCloser, type Closer } from '../utils/idle.js';
import { serial } from '../utils/serial.js';
import { log } from '../utils/log.js';
import { logAction } from '../utils/log-command.js';

const api = new ApiClient();
const CONTEST_FORM = 'contestform';
const REASON = 'reason';

// One open editor per report, so two never edit at once. It closes after two
// minutes idle (ten with a form out), and always before its token expires.
const editors = idleCloser();
const IDLE_MS = 2 * 60_000;
const FORM_MS = 10 * 60_000;
const TOKEN_MS = 14 * 60_000;
// Saves on one report take turns, so a quick second pick reads the first.
const inTurn = serial();
type EditorPress = ButtonInteraction | AnySelectMenuInteraction | ModalSubmitInteraction;
// Closing waits its turn behind any pick in progress, so the closed notice is
// the last thing the editor shows and no draft outlives it.
const closerFor = (interaction: EditorPress, matchId: string): Closer => ({
  close: () =>
    inTurn(matchId, async () => {
      drafts.delete(matchId);
      await replacePanel(interaction, closedEditor());
    }),
  until: interaction.createdTimestamp + TOKEN_MS,
});

// A set-order or assign draft: the match as its panel opened on it, and as
// the picks since have changed it. Save sends the difference.
type DraftKind = 'order' | 'assign';
type Draft = Readonly<{ kind: DraftKind; base: Match; now: Match }>;
const drafts = new Map<string, Draft>();

// A read before a form opens must beat Discord's 3 second window, so a slow
// league server is said plainly rather than left to time out.
async function beforeForm<T>(read: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Refusal('The league server is slow right now. Try again in a moment.')), 2_500);
  });
  try {
    return await Promise.race([read, late]);
  } finally {
    clearTimeout(timer);
  }
}

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
  [EDIT.order]: 'open the order panel',
  [EDIT.orderPick]: 'move that place',
  [EDIT.assign]: 'open the assign panel',
  [EDIT.assignPick]: 'set that seat',
  [EDIT.save]: 'save the changes',
  [EDIT.tie]: 'open the tie form',
  [EDIT.tieForm]: 'save the tie',
  [EDIT.quits]: 'open the quits form',
  [EDIT.quitsForm]: 'save who quit',
  [EDIT.civs]: 'open the civ picker',
  [EDIT.civSeat]: 'show that seat',
  [EDIT.civPick]: 'save the civ',
  [EDIT.back]: 'go back to the editor',
  [EDIT.done]: 'close the editor',
};

// Approve is for admins and developers. Once the match is rated, posting to
// history and clearing the uploads queue are best effort; without history it stays.
async function approve(interaction: ButtonInteraction, matchId: string): Promise<void> {
  if (!isAdminOrDeveloper(interaction)) refuse('Only an admin or a developer can approve a report.');
  await defer(interaction, 'private');
  const match = await api.approve(matchId, { id: interaction.user.id, isStaff: true });
  editors.close(matchId);
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
  const match = await beforeForm(api.match(matchId));
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
  if (await refreshReport(interaction.client, match, reportPanel(await viewOf(match, api)))) {
    await say(interaction, 'success', 'Your contest is on the report. Staff see it before they approve.');
  } else {
    await say(interaction, 'failed', 'Your contest is recorded, but the report could not be updated.');
  }
  await logAction(interaction, 'contest', { matchId, reason });
}

// Done closes the editor at once, rather than waiting for it to go idle.
async function done(interaction: ButtonInteraction, matchId: string): Promise<void> {
  if (!editors.touch(matchId, interaction.message.id, IDLE_MS, closerFor(interaction, matchId))) refuse(EDITOR_CLOSED);
  await holdPanel(interaction);
  editors.close(matchId);
}

// The editor is the reporter's or staff's; core-api checks the reporter
// again on every save, and only staff may set a tie.
async function openEditor(interaction: ButtonInteraction, matchId: string): Promise<void> {
  await defer(interaction, 'private');
  const match = await api.match(matchId);
  const staff = isStaff(interaction);
  if (!staff && match.reporter_discord_id !== interaction.user.id) refuse('Only the reporter or staff can edit this report.');
  const panel = await editorOf(interaction.guild, match, staff, api);
  const holder = editors.holder(matchId);
  if (holder && holder !== interaction.user.id) {
    refuse(`${mention(holder)} is editing this report. It frees up when they finish, or when it goes idle.`);
  }
  // The deferred reply is edited, so the editor's message comes straight back.
  const editor = await respond(interaction, panel, 'private');
  if (editor) editors.open(matchId, interaction.user.id, editor.id, closerFor(interaction, matchId), IDLE_MS);
}

// A form from the editor, built from the report as it is now. The members
// were loaded with the editor, so naming them costs no fetch.
async function openForm(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  matchId: string,
  build: (match: Match, names: CivNames, members: Members) => ModalBuilder | null,
  nothing = 'The report has changed. Open the editor again.',
): Promise<void> {
  if (!editors.touch(matchId, interaction.message.id, FORM_MS)) refuse(EDITOR_CLOSED);
  const [match, names] = await beforeForm(
    api.match(matchId).then(async (m) => [m, await civNames(editionOf(m.game), api)] as const),
  );
  const form = build(match, names, memberNames(interaction.guild, playerIds(match)));
  if (!form) refuse(nothing);
  await interaction.showModal(form);
}

// Save, then rewrite the public report and the private panel together, from
// the one saved match, so neither shows anything the other does not.
async function saveSeats(
  interaction: EditorPress,
  matchId: string,
  action: string,
  seats: readonly SeatEdit[],
  next: (match: Match) => Promise<Panel> = (m) => editorOf(interaction.guild, m, isStaff(interaction), api),
): Promise<void> {
  const match = await api.editSeats(matchId, seats, { id: interaction.user.id, isStaff: isStaff(interaction) });
  const [view, panel] = await Promise.all([viewOf(match, api), next(match)]);
  const [published] = await Promise.all([
    refreshReport(interaction.client, match, reportPanel(view)),
    replacePanel(interaction, panel),
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
  const open = editors.touch(matchId, interaction.message?.id ?? '', IDLE_MS, closerFor(interaction, matchId));
  if (!open) refuse(EDITOR_CLOSED);
  await inTurn(matchId, async () => {
    const edits = editsOf(await api.match(matchId));
    if (!edits.length) await say(interaction, 'muted', unchanged);
    else await saveSeats(interaction, matchId, action, edits);
  });
}

// A press on the editor's own message holds it and keeps it open.
async function hold(interaction: ButtonInteraction | AnySelectMenuInteraction, matchId: string): Promise<void> {
  await holdPanel(interaction);
  if (!editors.touch(matchId, interaction.message.id, IDLE_MS, closerFor(interaction, matchId))) refuse(EDITOR_CLOSED);
}

// The civ picker, in place of the editor, on the seat `focus` chooses.
async function showCivs(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  matchId: string,
  focus: (match: Match, names: CivNames) => number,
): Promise<void> {
  if (!isStaff(interaction)) refuse('Only staff can set civs.');
  await hold(interaction, matchId);
  const match = await api.match(matchId);
  const names = await civNames(editionOf(match.game), api);
  const members = memberNames(interaction.guild, playerIds(match));
  await replacePanel(interaction, civsPanel(match, names, members, focus(match, names)));
}

// A pick saves at once, and the picker moves on to the next unknown seat.
async function pickCiv(interaction: StringSelectMenuInteraction, matchId: string, n: number): Promise<void> {
  if (!isStaff(interaction)) refuse('Only staff can set civs.');
  await hold(interaction, matchId);
  await inTurn(matchId, async () => {
    const match = await api.match(matchId);
    const edit = civPickEdit(match, n, interaction.values[0] ?? '');
    if (!edit) return say(interaction, 'muted', `Seat ${n} already has that one.`);
    const names = await civNames(editionOf(match.game), api);
    return saveSeats(interaction, matchId, 'set-civ', [edit], async (m) =>
      civsPanel(m, names, memberNames(interaction.guild, playerIds(m)), civFocus(m, names, n)),
    );
  });
}

async function back(interaction: ButtonInteraction, matchId: string): Promise<void> {
  await hold(interaction, matchId);
  await inTurn(matchId, async () => {
    drafts.delete(matchId);
    const match = await api.match(matchId);
    await replacePanel(interaction, await editorOf(interaction.guild, match, isStaff(interaction), api));
  });
}

// Opens a draft panel, or applies one pick to its draft and redraws it. A
// pick the bot holds no draft for starts again from the report as it is.
async function draft(
  interaction: ButtonInteraction | AnySelectMenuInteraction,
  matchId: string,
  kind: DraftKind,
  pick?: (match: Match) => Match | string,
): Promise<void> {
  await hold(interaction, matchId);
  await inTurn(matchId, async () => {
    let held = drafts.get(matchId);
    if (!held || !pick || held.kind !== kind) {
      const match = await api.match(matchId);
      held = { kind, base: match, now: match };
    }
    const next = pick ? pick(held.now) : held.now;
    if (typeof next === 'string') await say(interaction, 'refused', next);
    else held = { ...held, now: next };
    drafts.set(matchId, held);
    const names = await civNames(editionOf(held.now.game), api);
    const members = memberNames(interaction.guild, playerIds(held.now));
    const changed = draftEdits(held.base, held.now).length;
    const panel = kind === 'order' ? orderPanel(held.now, names, members, changed) : assignPanel(held.now, names, members, changed);
    await replacePanel(interaction, panel);
  });
}

// Save sends the whole draft as one edit; a refused one keeps the draft.
async function saveDraft(interaction: ButtonInteraction, matchId: string): Promise<void> {
  await hold(interaction, matchId);
  await inTurn(matchId, async () => {
    const held = drafts.get(matchId);
    const edits = held ? draftEdits(held.base, held.now) : [];
    if (!held || !edits.length) {
      drafts.delete(matchId);
      const match = await api.match(matchId);
      await replacePanel(interaction, await editorOf(interaction.guild, match, isStaff(interaction), api));
      return;
    }
    await saveSeats(interaction, matchId, held.kind === 'order' ? 'set-order' : 'assign-players', edits);
    drafts.delete(matchId);
  });
}

const selected = (interaction: ModalSubmitInteraction, field: string): readonly string[] =>
  interaction.fields.getStringSelectValues(field);


export async function handleReportInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isStringSelectMenu() && !interaction.isUserSelectMenu()) {
    return false;
  }
  const id = parseId(interaction.customId);
  if (id?.surface !== 'report') return false;
  const matchId = id.args[0] ?? '';
  // The seat number of a seat form, civ pick or assign pick; for an order
  // pick, the place it sets (0 is 1st).
  const at = Number(id.args[1] ?? 0);
  try {
    if (interaction.isButton() && id.verb === 'approve') await approve(interaction, matchId);
    else if (interaction.isButton() && id.verb === 'contest') await openContest(interaction, matchId);
    else if (interaction.isModalSubmit() && id.verb === CONTEST_FORM) await submitContest(interaction, matchId);
    else if (interaction.isButton() && id.verb === 'edit') await openEditor(interaction, matchId);
    else if (interaction.isButton() && id.verb === EDIT.done) await done(interaction, matchId);
    else if (interaction.isStringSelectMenu() && id.verb === EDIT.seat) {
      await openForm(interaction, matchId, (m, _n, members) => seatForm(m, Number(interaction.values[0]), members));
    } else if (interaction.isButton() && id.verb === EDIT.assign) {
      await draft(interaction, matchId, 'assign');
    } else if (interaction.isUserSelectMenu() && id.verb === EDIT.assignPick) {
      await draft(interaction, matchId, 'assign', (m) => withAssignPick(m, at, interaction.values[0] ?? ''));
    } else if (interaction.isButton() && id.verb === EDIT.order) {
      await draft(interaction, matchId, 'order');
    } else if (interaction.isStringSelectMenu() && id.verb === EDIT.orderPick) {
      const holder = Number(id.args[2]);
      await draft(interaction, matchId, 'order', (m) => withOrderPick(m, at, holder, Number(interaction.values[0])));
    } else if (interaction.isButton() && id.verb === EDIT.save) {
      await saveDraft(interaction, matchId);
    } else if (interaction.isButton() && id.verb === EDIT.quits) {
      await openForm(interaction, matchId, quitsForm, 'Assign players before marking who quit.');
    } else if (interaction.isButton() && id.verb === EDIT.tie) {
      if (!isStaff(interaction)) refuse('Only staff can set a tie.');
      await openForm(interaction, matchId, tieForm);
    } else if (interaction.isButton() && id.verb === EDIT.civs) {
      await showCivs(interaction, matchId, (m, names) => civFocus(m, names));
    } else if (interaction.isStringSelectMenu() && id.verb === EDIT.civSeat) {
      await showCivs(interaction, matchId, () => Number(interaction.values[0]));
    } else if (interaction.isStringSelectMenu() && id.verb === EDIT.civPick) {
      await pickCiv(interaction, matchId, at);
    } else if (interaction.isButton() && id.verb === EDIT.back) {
      await back(interaction, matchId);
    } else if (interaction.isModalSubmit() && id.verb === EDIT.seatForm) {
      const choice = {
        player: picked(interaction, FIELD.player),
        place: Number(selected(interaction, FIELD.finished)[0]),
        shown: Number(id.args[2]),
        quit: interaction.fields.getCheckbox(FIELD.quit),
        left: picked(interaction, FIELD.left),
      };
      await submit(interaction, matchId, 'edit-seat', 'Nothing changed on that seat.', (m) => seatEdits(m, at, choice));
    } else if (interaction.isModalSubmit() && id.verb === EDIT.quitsForm) {
      await submit(interaction, matchId, 'set-quits', 'Nobody changed.', (m) => quitEdits(m, selected(interaction, FIELD.quits)));
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
