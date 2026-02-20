import {
  ActionRowBuilder,
  ModalBuilder,
  MessageFlags,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Message,
  type MessageActionRowComponentBuilder,
  type MessageComponentInteraction,
} from 'discord.js';

import { config } from '../config.js';
import { EMOJI_CONFIRM, EMOJI_FAIL, MAX_DISCORD_LEN } from '../config/constants.js';
import {
  assignDiscordId,
  assignSub,
  getMatch,
  removeSub,
  setPlacements,
  triggerQuit,
} from './reporting.service.js';
import { REPORT_EDITS_CID } from '../interactions/report-edits.js';
import {
  REPORT_EDITS_COLLECTOR_IDLE_MS,
  type ReportEditsAction,
  type ReportEditsOrderDraft,
  type ReportEditsState,
} from '../types/report-edits.js';
import { buildReportEmbed } from '../ui/layouts/report.layout.js';
import { buildFinishedReportEditsEmbed, buildReportEditsEmbed } from '../ui/embeds/report-edits.js';
import {
  buildActionSelect,
  buildButtons,
  buildDiscordSlotSelect,
  buildDiscordUserSelect,
  buildOrderPlacementSelect,
  buildOrderTargetSelect,
  buildRemoveSubSelect,
  buildSubInSelect,
  buildSubOutUserSelect,
  buildTriggerPlayerSelect,
} from '../ui/components/report-edits.js';
import { convertMatchToStr } from '../utils/convert-match-to-str.js';
import { parseDiscordUserId } from '../utils/parse-discord-id.js';

import type { GetMatchResponse, ParsedPlayer } from '../api/types.js';
import type { BaseReport } from '../types/reports.js';

type ApplyResult =
  | { ok: true; updated: GetMatchResponse }
  | { ok: false; message: string };

type SessionRow = ActionRowBuilder<MessageActionRowComponentBuilder>;

type SendableChannel = {
  send: (options: { content: string }) => Promise<Message>;
};

type FetchableMessagesChannel = {
  messages: { fetch: (id: string) => Promise<Message> };
};

function truncateForDiscord(content: string): string {
  if (content.length <= MAX_DISCORD_LEN) return content;
  return content.slice(0, Math.max(0, MAX_DISCORD_LEN - 20)) + '… (truncated)';
}

async function safeEphemeral(
  interaction: ChatInputCommandInteraction,
  content: string
): Promise<void> {
  const payload = { content, flags: MessageFlags.Ephemeral } as const;
  try {
    if (interaction.deferred) {
      await interaction.editReply({ content });
      return;
    }
    if (interaction.replied) {
      await interaction.followUp(payload);
      return;
    }
    await interaction.reply(payload);
  } catch {
    // ignore
  }
}

async function ackComponent(i: MessageComponentInteraction): Promise<void> {
  try {
    if (!i.deferred && !i.replied) await i.deferUpdate();
  } catch {
    // ignore
  }
}

function hasStaffRole(roleIds: readonly string[]): boolean {
  return (
    roleIds.includes(config.discord.roles.moderator) ||
    roleIds.includes(config.discord.roles.developer)
  );
}

async function getInvokerRoleIds(
  interaction: ChatInputCommandInteraction
): Promise<string[]> {
  if (interaction.inCachedGuild()) {
    return Array.from(interaction.member.roles.cache.keys());
  }

  try {
    const member = await interaction.guild?.members.fetch(interaction.user.id);
    return member ? Array.from(member.roles.cache.keys()) : [];
  } catch {
    return [];
  }
}

function resetActionState(state: ReportEditsState): ReportEditsState {
  return {
    ...state,
    stage: 'ACTION',
    action: null,

    subInIndex: undefined,
    subOutDiscordId: undefined,

    removeSubIndex: undefined,

    discordIdSlotIndex: undefined,
    discordIdPending: undefined,

    orderDraft: undefined,
    orderSelectedTeamId: undefined,
    orderSelectedPlacement: undefined,

    triggerKind: undefined,
    triggerDiscordId: undefined,
  };
}

export function computeOrderDraft(
  players: ParsedPlayer[]
): { ok: true; draft: ReportEditsOrderDraft } | { ok: false; message: string } {
  const teamIds = Array.from(new Set(players.map((p) => p.team))).sort(
    (a, b) => a - b
  );
  const numTeams = teamIds.length;

  // Backend indexes new_order_list by player.team, so team ids must be 0..numTeams-1.
  for (let i = 0; i < numTeams; i++) {
    if (teamIds[i] !== i) {
      return {
        ok: false,
        message: `Invalid team ids in match (expected 0..${numTeams - 1}, got: ${teamIds.join(
          ', '
        )})`,
      };
    }
  }

  const kind: ReportEditsOrderDraft['kind'] =
    numTeams < players.length ? 'team' : 'player';

  const placementsByTeamId: Record<number, number> = {};
  const usedPlacements = new Set<number>();

  // Normalize: best placement per team (min), enforce a bijection 1..numTeams.
  for (const teamId of teamIds) {
    const members = players.filter((p) => p.team === teamId);
    const placements = members
      .map((p) => p.placement)
      .filter((v): v is number => typeof v === 'number');

    const raw = placements.length ? Math.min(...placements) + 1 : undefined;
    if (typeof raw === 'number' && raw >= 1 && raw <= numTeams && !usedPlacements.has(raw)) {
      placementsByTeamId[teamId] = raw;
      usedPlacements.add(raw);
    }
  }

  const remaining: number[] = [];
  for (let p = 1; p <= numTeams; p++) if (!usedPlacements.has(p)) remaining.push(p);

  for (const teamId of teamIds) {
    if (typeof placementsByTeamId[teamId] === 'number') continue;
    placementsByTeamId[teamId] = remaining.shift() ?? teamId + 1;
  }

  return { ok: true, draft: { kind, teamIds, placementsByTeamId } };
}

export function buildNewOrderString(draft: ReportEditsOrderDraft): string {
  const arr: string[] = [];
  for (const teamId of draft.teamIds) {
    arr[teamId] = String(draft.placementsByTeamId[teamId]);
  }
  return arr.join(' ');
}

export function validateOrderDraft(
  draft: ReportEditsOrderDraft
): { ok: true } | { ok: false; message: string } {
  const n = draft.teamIds.length;
  const placements: number[] = [];
  for (const teamId of draft.teamIds) {
    const p = draft.placementsByTeamId[teamId];
    if (typeof p !== 'number') {
      return { ok: false, message: 'Missing placement.' };
    }
    if (p < 1 || p > n) {
      return { ok: false, message: `Invalid placement value: ${p}.` };
    }
    placements.push(p);
  }

  const uniq = new Set(placements);
  if (uniq.size !== n) {
    return { ok: false, message: 'Duplicate placements detected.' };
  }

  return { ok: true };
}

export function applyOrderSelection(
  draft: ReportEditsOrderDraft,
  placement: number,
  teamId: number
): ReportEditsOrderDraft {
  const currentPlacement = draft.placementsByTeamId[teamId];
  if (typeof currentPlacement !== 'number' || currentPlacement === placement) return draft;

  const otherTeamId = draft.teamIds.find((t) => draft.placementsByTeamId[t] === placement);
  if (typeof otherTeamId === 'number' && otherTeamId !== teamId) {
    draft.placementsByTeamId[otherTeamId] = currentPlacement;
  }
  draft.placementsByTeamId[teamId] = placement;
  return draft;
}

function isSendableChannel(ch: unknown): ch is SendableChannel {
  if (!ch || typeof ch !== 'object') return false;
  const obj = ch as Record<string, unknown>;
  return 'send' in obj && typeof obj.send === 'function';
}

function hasFetchableMessages(ch: unknown): ch is FetchableMessagesChannel {
  if (!ch || typeof ch !== 'object') return false;
  const obj = ch as Record<string, unknown>;
  if (!('messages' in obj)) return false;
  const messages = obj.messages as unknown;
  if (!messages || typeof messages !== 'object') return false;
  const m = messages as Record<string, unknown>;
  return 'fetch' in m && typeof m.fetch === 'function';
}

async function postAuditMessage(
  interaction: ChatInputCommandInteraction,
  content: string
): Promise<Message | null> {
  const ch = interaction.channel;
  if (!isSendableChannel(ch)) return null;
  try {
    return await ch.send({ content });
  } catch {
    return null;
  }
}

async function updatePublicReportMessage(
  interaction: ChatInputCommandInteraction,
  updated: GetMatchResponse
): Promise<void> {
  const report = updated as BaseReport;
  const embedMsgId = report.discord_messages_id_list?.[0];
  if (!embedMsgId) return;

  const ch = interaction.channel;
  if (!hasFetchableMessages(ch)) return;

  try {
    const msg = await ch.messages.fetch(embedMsgId);
    if (msg.editable) {
      const embed = buildReportEmbed(updated, { reporterId: interaction.user.id });
      await msg.edit({ embeds: [embed] });
    }
  } catch {
    // preserve existing behavior: ignore if not found
  }
}

async function applyAssignSub(
  interaction: ChatInputCommandInteraction,
  state: ReportEditsState
): Promise<ApplyResult> {
  if (typeof state.subInIndex !== 'number' || !state.subOutDiscordId) {
    return { ok: false, message: 'Select sub-in slot and sub-out user.' };
  }

  const audit = await postAuditMessage(
    interaction,
    `Assigning substitute…\nMatch ID: **${state.matchId}**`
  );
  if (!audit) {
    return {
      ok: false,
      message: `${EMOJI_FAIL} Failed to post audit message. Edit aborted.`,
    };
  }

  try {
    const res = await assignSub(
      state.matchId,
      String(state.subInIndex),
      state.subOutDiscordId,
      audit.id
    );

    const header =
      `${EMOJI_CONFIRM} Substitute <@${state.subOutDiscordId}> assigned by <@${interaction.user.id}>\n` +
      `Match ID: **${res.match_id}**\n`;

    await audit
      .edit(truncateForDiscord(header + convertMatchToStr(res as BaseReport, false)))
      .catch(() => null);

    await updatePublicReportMessage(interaction, res);
    return { ok: true, updated: res };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await audit.edit(`${EMOJI_FAIL} Assign Sub failed: ${msg}`).catch(() => null);
    return { ok: false, message: `${EMOJI_FAIL} Assign Sub failed: ${msg}` };
  }
}

async function applyRemoveSub(
  interaction: ChatInputCommandInteraction,
  state: ReportEditsState
): Promise<ApplyResult> {
  if (typeof state.removeSubIndex !== 'number') {
    return { ok: false, message: 'Select a sub slot to remove.' };
  }

  const idx = state.removeSubIndex;
  const subOutDiscordId = state.match.players[idx]?.discord_id;

  const audit = await postAuditMessage(
    interaction,
    `Removing substitute…\nMatch ID: **${state.matchId}**`
  );
  if (!audit) {
    return {
      ok: false,
      message: `${EMOJI_FAIL} Failed to post audit message. Edit aborted.`,
    };
  }

  try {
    const res = await removeSub(state.matchId, String(idx), audit.id);

    const header =
      `${EMOJI_CONFIRM} Substitute ${subOutDiscordId ? `<@${subOutDiscordId}>` : ''} removed by <@${interaction.user.id}>\n` +
      `Match ID: **${res.match_id}**\n`;

    await audit
      .edit(truncateForDiscord(header + convertMatchToStr(res as BaseReport, false)))
      .catch(() => null);

    await updatePublicReportMessage(interaction, res);
    return { ok: true, updated: res };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await audit.edit(`${EMOJI_FAIL} Remove Sub failed: ${msg}`).catch(() => null);
    return { ok: false, message: `${EMOJI_FAIL} Remove Sub failed: ${msg}` };
  }
}

async function applyDiscordId(
  interaction: ChatInputCommandInteraction,
  state: ReportEditsState
): Promise<ApplyResult> {
  if (typeof state.discordIdSlotIndex !== 'number' || !state.discordIdPending) {
    return { ok: false, message: 'Select a slot and a Discord user/ID.' };
  }

  const idx = state.discordIdSlotIndex;
  const audit = await postAuditMessage(
    interaction,
    `Assigning Discord ID…\nMatch ID: **${state.matchId}**`
  );
  if (!audit) {
    return {
      ok: false,
      message: `${EMOJI_FAIL} Failed to post audit message. Edit aborted.`,
    };
  }

  try {
    const res = await assignDiscordId(
      state.matchId,
      String(idx),
      state.discordIdPending,
      audit.id
    );

    const header =
      `${EMOJI_CONFIRM} <@${state.discordIdPending}> assigned by <@${interaction.user.id}>\n` +
      `Match ID: **${res.match_id}**\n`;

    await audit
      .edit(truncateForDiscord(header + convertMatchToStr(res as BaseReport, false)))
      .catch(() => null);

    await updatePublicReportMessage(interaction, res);
    return { ok: true, updated: res };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await audit.edit(`${EMOJI_FAIL} Assign Discord ID failed: ${msg}`).catch(() => null);
    return { ok: false, message: `${EMOJI_FAIL} Assign Discord ID failed: ${msg}` };
  }
}

async function applyOrder(
  interaction: ChatInputCommandInteraction,
  state: ReportEditsState
): Promise<ApplyResult> {
  if (!state.orderDraft) return { ok: false, message: 'Order draft is missing.' };

  const v = validateOrderDraft(state.orderDraft);
  if (!v.ok) return { ok: false, message: `${EMOJI_FAIL} ${v.message}` };

  const newOrder = buildNewOrderString(state.orderDraft);

  const audit = await postAuditMessage(
    interaction,
    `Changing report order…\nMatch ID: **${state.matchId}**`
  );
  if (!audit) {
    return {
      ok: false,
      message: `${EMOJI_FAIL} Failed to post audit message. Edit aborted.`,
    };
  }

  try {
    const res = await setPlacements(state.matchId, newOrder, audit.id);

    const header =
      `${EMOJI_CONFIRM} Match order changed by <@${interaction.user.id}>\n` +
      `Match ID: **${res.match_id}**\n`;

    await audit
      .edit(truncateForDiscord(header + convertMatchToStr(res as BaseReport, false)))
      .catch(() => null);

    await updatePublicReportMessage(interaction, res);
    return { ok: true, updated: res };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await audit.edit(`${EMOJI_FAIL} Change Order failed: ${msg}`).catch(() => null);
    return { ok: false, message: `${EMOJI_FAIL} Change Order failed: ${msg}` };
  }
}

async function applyTrigger(
  interaction: ChatInputCommandInteraction,
  state: ReportEditsState
): Promise<ApplyResult> {
  if (!state.triggerKind || !state.triggerDiscordId) {
    return { ok: false, message: 'Select a player.' };
  }

  const label = state.triggerKind === 'lagger' ? 'Lagger' : 'Quit';

  const audit = await postAuditMessage(
    interaction,
    `Triggering ${label.toLowerCase()}…\nMatch ID: **${state.matchId}**`
  );
  if (!audit) {
    return {
      ok: false,
      message: `${EMOJI_FAIL} Failed to post audit message. Edit aborted.`,
    };
  }

  try {
    const res = await triggerQuit(state.matchId, state.triggerDiscordId, audit.id);

    const header =
      `${EMOJI_CONFIRM} Player <@${state.triggerDiscordId}> ${label.toLowerCase()} toggled by <@${interaction.user.id}>\n` +
      `Match ID: **${res.match_id}**\n`;

    await audit
      .edit(truncateForDiscord(header + convertMatchToStr(res as BaseReport, false)))
      .catch(() => null);

    await updatePublicReportMessage(interaction, res);
    return { ok: true, updated: res };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await audit.edit(`${EMOJI_FAIL} Trigger ${label} failed: ${msg}`).catch(() => null);
    return { ok: false, message: `${EMOJI_FAIL} Trigger ${label} failed: ${msg}` };
  }
}

function canApply(state: ReportEditsState): boolean {
  switch (state.stage) {
    case 'SUB_ASSIGN':
      return typeof state.subInIndex === 'number' && Boolean(state.subOutDiscordId);
    case 'SUB_REMOVE':
      return typeof state.removeSubIndex === 'number';
    case 'DISCORD_ID':
      return (
        typeof state.discordIdSlotIndex === 'number' && Boolean(state.discordIdPending)
      );
    case 'ORDER':
      return Boolean(state.orderDraft && validateOrderDraft(state.orderDraft).ok);
    case 'TRIGGER':
      return Boolean(state.triggerKind && state.triggerDiscordId);
    default:
      return false;
  }
}

function renderComponents(state: ReportEditsState, disableAll: boolean): SessionRow[] {
  const rows: SessionRow[] = [];

  const actionRow = buildActionSelect(state);
  if (disableAll) actionRow.components[0].setDisabled(true);
  rows.push(actionRow as unknown as SessionRow);

  const pushDisabled = (row: ActionRowBuilder<MessageActionRowComponentBuilder>) => {
    row.components[0].setDisabled(true);
    rows.push(row);
  };

  if (state.stage === 'SUB_ASSIGN') {
    const r1 = buildSubInSelect(state);
    const r2 = buildSubOutUserSelect(state);

    if (disableAll) {
      pushDisabled(r1);
      pushDisabled(r2);
    } else {
      rows.push(r1);
      rows.push(r2);
    }
  } else if (state.stage === 'SUB_REMOVE') {
    const r = buildRemoveSubSelect(state);
    if (disableAll) pushDisabled(r);
    else rows.push(r);
  } else if (state.stage === 'DISCORD_ID') {
    const r1 = buildDiscordSlotSelect(state);
    const r2 = buildDiscordUserSelect(state);

    if (disableAll) {
      pushDisabled(r1);
      pushDisabled(r2);
    } else {
      rows.push(r1);
      rows.push(r2);
    }
  } else if (state.stage === 'ORDER') {
    const r1 = buildOrderPlacementSelect(state);
    const r2 = buildOrderTargetSelect(state);

    if (disableAll) {
      pushDisabled(r1);
      pushDisabled(r2);
    } else {
      rows.push(r1);
      rows.push(r2);
    }
  } else if (state.stage === 'TRIGGER') {
    const r = buildTriggerPlayerSelect(state);
    if (disableAll) pushDisabled(r);
    else rows.push(r);
  }

  const buttons = buildButtons({
    showBack: state.stage !== 'ACTION',
    canApply: canApply(state),
    disableAll,
    showEnterId: state.stage === 'DISCORD_ID',
  });
  rows.push(buttons as unknown as SessionRow);

  return rows;
}

export async function startReportEditsSession(
  interaction: ChatInputCommandInteraction,
  matchId: string
): Promise<void> {
  if (!interaction.inGuild()) {
    await safeEphemeral(
      interaction,
      `${EMOJI_FAIL} This command must be used in a server.`
    );
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const roleIds = await getInvokerRoleIds(interaction);
  const isStaff = hasStaffRole(roleIds);

  let match: GetMatchResponse;
  try {
    match = await getMatch(matchId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await interaction.editReply(
      `${EMOJI_FAIL} Could not load match **${matchId}**: ${msg}`
    );
    return;
  }

  if (!match?.reporter_discord_id) {
    await interaction.editReply(
      `${EMOJI_FAIL} Match **${matchId}** has no reporter. Cannot edit.`
    );
    return;
  }

  const isUploader = match.reporter_discord_id === interaction.user.id;
  if (!isUploader && !isStaff) {
    await interaction.editReply(
      `${EMOJI_FAIL} Only the original uploader <@${match.reporter_discord_id}> or staff can use /report-edits.`
    );
    return;
  }

  let state: ReportEditsState = {
    matchId,
    match,
    initiatorId: interaction.user.id,
    isStaff,
    stage: 'ACTION',
    action: null,
    lastNotice: 'Choose an action to begin.',
  };

  await interaction.editReply({
    embeds: [buildReportEditsEmbed(state)],
    components: renderComponents(state, false),
  });

  const reply = (await interaction.fetchReply()) as Message;

  const collector = reply.createMessageComponentCollector({
    idle: REPORT_EDITS_COLLECTOR_IDLE_MS,
  });

  let finished = false;

  async function refresh(): Promise<void> {
    try {
      await interaction.editReply({
        embeds: [buildReportEditsEmbed(state)],
        components: renderComponents(state, false),
      });
    } catch {
      // ignore
    }
  }

  async function endSession(reason: 'Finished' | 'Cancelled' | 'Timed out') {
    if (finished) return;
    finished = true;

    try {
      await interaction.editReply({
        embeds: [buildFinishedReportEditsEmbed(state, reason)],
        components: renderComponents(state, true),
      });
    } catch {
      // ignore
    }

    try {
      collector.stop(reason);
    } catch {
      // ignore
    }
  }

  collector.on('collect', async (i: MessageComponentInteraction) => {
    if (finished) {
      await ackComponent(i);
      return;
    }

    if (i.user.id !== state.initiatorId) {
      try {
        if (!i.replied && !i.deferred) {
          await i.reply({
            content: `${EMOJI_FAIL} This session isn't for you.`,
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch {
        // ignore
      }
      return;
    }

    // Modal trigger must NOT be deferred.
    if (i.isButton() && i.customId === REPORT_EDITS_CID.discordEnter) {
      if (state.stage !== 'DISCORD_ID') return;

      const modal = new ModalBuilder()
        .setCustomId(REPORT_EDITS_CID.discordModal)
        .setTitle('Assign Discord ID');

      const input = new TextInputBuilder()
        .setCustomId('discord_id')
        .setLabel('Discord ID or @mention')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(64);

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(input)
      );

      try {
        await i.showModal(modal);
      } catch {
        return;
      }

      try {
        const submitted = await i.awaitModalSubmit({
          time: 60_000,
          filter: (m) =>
            m.customId === REPORT_EDITS_CID.discordModal &&
            m.user.id === state.initiatorId,
        });

        const raw = submitted.fields.getTextInputValue('discord_id');
        const parsed = parseDiscordUserId(raw);
        if (!parsed) {
          await submitted.reply({
            content: `${EMOJI_FAIL} Invalid Discord ID. Use a numeric ID or tag the user (e.g. <@123...>).`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await submitted.deferUpdate().catch(() => null);
        if (typeof state.discordIdSlotIndex !== 'number') {
          state.lastNotice = `${EMOJI_FAIL} Select a slot first.`;
          await refresh();
          return;
        }
        state.discordIdPending = parsed;
        state.lastNotice = 'Ready. Click Apply to assign the Discord ID.';
        await refresh();
      } catch {
        state.lastNotice = `${EMOJI_FAIL} ID entry timed out.`;
        await refresh();
      }

      return;
    }

    await ackComponent(i);

    if (i.isStringSelectMenu() && i.customId === REPORT_EDITS_CID.action) {
      const action = i.values[0] as ReportEditsAction;

      state = { ...resetActionState(state), action, lastNotice: '' };

      if (action === 'SUB_ASSIGN') {
        state.stage = 'SUB_ASSIGN';
        state.lastNotice = 'Select a sub-in slot and the sub-out user.';
      } else if (action === 'SUB_REMOVE') {
        state.stage = 'SUB_REMOVE';
        state.lastNotice = 'Select the sub slot to remove.';
      } else if (action === 'DISCORD_ID') {
        state.stage = 'DISCORD_ID';
        state.lastNotice = 'Select a slot missing a Discord ID, then pick a user (or Enter ID).';
      } else if (action === 'ORDER') {
        state.stage = 'ORDER';
        const d = computeOrderDraft(state.match.players);
        if (!d.ok) state.lastNotice = `${EMOJI_FAIL} ${d.message}`;
        else {
          state.orderDraft = d.draft;
          state.lastNotice =
            'Select a placement, then select a team/player to swap into that place. Click Apply to commit.';
        }
      } else if (action === 'TRIGGER_QUIT' || action === 'TRIGGER_LAGGER') {
        state.stage = 'TRIGGER';
        state.triggerKind = action === 'TRIGGER_LAGGER' ? 'lagger' : 'quit';
        state.lastNotice = 'Select a player, then click Apply.';
      }

      await refresh();
      return;
    }

    if (i.isStringSelectMenu() && i.customId === REPORT_EDITS_CID.subIn) {
      state.subInIndex = Number(i.values[0]);
      state.lastNotice = 'Select the sub-out user, then click Apply.';
      await refresh();
      return;
    }

    if (i.isUserSelectMenu() && i.customId === REPORT_EDITS_CID.subOut) {
      state.subOutDiscordId = i.values[0];
      state.lastNotice = 'Ready. Click Apply to assign the substitute.';
      await refresh();
      return;
    }

    if (i.isStringSelectMenu() && i.customId === REPORT_EDITS_CID.removeSub) {
      state.removeSubIndex = Number(i.values[0]);
      state.lastNotice = 'Ready. Click Apply to remove the substitute.';
      await refresh();
      return;
    }

    if (i.isStringSelectMenu() && i.customId === REPORT_EDITS_CID.discordSlot) {
      state.discordIdSlotIndex = Number(i.values[0]);
      state.discordIdPending = undefined;
      state.lastNotice = 'Select a user (or Enter ID), then click Apply.';
      await refresh();
      return;
    }

    if (i.isUserSelectMenu() && i.customId === REPORT_EDITS_CID.discordUser) {
      state.discordIdPending = i.values[0];
      state.lastNotice = 'Ready. Click Apply to assign the Discord ID.';
      await refresh();
      return;
    }

    if (i.isStringSelectMenu() && i.customId === REPORT_EDITS_CID.orderTeam) {
      if (!state.orderDraft || state.stage !== 'ORDER') {
        state.lastNotice = `${EMOJI_FAIL} Order draft is missing.`;
        await refresh();
        return;
      }
      if (typeof state.orderSelectedPlacement !== 'number') {
        state.lastNotice = `${EMOJI_FAIL} Select a placement first.`;
        await refresh();
        return;
      }

      const teamId = Number(i.values[0]);
      state.orderSelectedTeamId = teamId;
      applyOrderSelection(state.orderDraft, state.orderSelectedPlacement, teamId);
      state.lastNotice = 'Draft updated. Click Apply when ready.';
      await refresh();
      return;
    }

    if (i.isStringSelectMenu() && i.customId === REPORT_EDITS_CID.orderPlacement) {
      state.orderSelectedPlacement = Number(i.values[0]);
      if (state.orderDraft) {
        const t = state.orderDraft.teamIds.find(
          (teamId) => state.orderDraft?.placementsByTeamId[teamId] === state.orderSelectedPlacement
        );
        state.orderSelectedTeamId = typeof t === 'number' ? t : undefined;
      }
      state.lastNotice = 'Select a team/player to swap into that placement.';
      await refresh();
      return;
    }

    if (i.isStringSelectMenu() && i.customId === REPORT_EDITS_CID.triggerPlayer) {
      state.triggerDiscordId = i.values[0];
      state.lastNotice = 'Ready. Click Apply to toggle.';
      await refresh();
      return;
    }

    if (!i.isButton()) return;

    if (i.customId === REPORT_EDITS_CID.cancel) {
      state.lastNotice = 'Cancelled.';
      await endSession('Cancelled');
      return;
    }

    if (i.customId === REPORT_EDITS_CID.finish) {
      state.lastNotice = 'Finished.';
      await endSession('Finished');
      return;
    }

    if (i.customId === REPORT_EDITS_CID.back) {
      state = resetActionState(state);
      state.lastNotice = 'Choose an action to begin.';
      await refresh();
      return;
    }

    if (i.customId === REPORT_EDITS_CID.apply) {
      state.lastNotice = 'Applying…';
      await refresh();

      let result: ApplyResult;
      if (state.stage === 'SUB_ASSIGN') {
        result = await applyAssignSub(interaction, state);
      } else if (state.stage === 'SUB_REMOVE') {
        result = await applyRemoveSub(interaction, state);
      } else if (state.stage === 'DISCORD_ID') {
        result = await applyDiscordId(interaction, state);
      } else if (state.stage === 'ORDER') {
        result = await applyOrder(interaction, state);
      } else if (state.stage === 'TRIGGER') {
        result = await applyTrigger(interaction, state);
      } else {
        result = { ok: false, message: 'Choose an action first.' };
      }

      if (!result.ok) {
        state.lastNotice = result.message;
        await refresh();
        return;
      }

      state.match = result.updated;
      state = resetActionState(state);
      state.lastNotice =
        `${EMOJI_CONFIRM} Applied successfully. Run another edit, or Finish.`;
      await refresh();
      return;
    }
  });

  collector.on('end', async (_collected, reason) => {
    if (finished) return;
    if (reason === 'Finished' || reason === 'Cancelled') return;
    state.lastNotice = 'Timed out.';
    await endSession('Timed out');
  });
}