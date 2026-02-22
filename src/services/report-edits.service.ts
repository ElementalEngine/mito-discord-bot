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
  assignDiscordIdAll,
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
  type ReportEditsStagedChanges,
  type ReportEditsState,
} from '../types/report-edits.js';
import { buildReportEmbed } from '../ui/layouts/report.layout.js';
import { buildFinishedReportEditsEmbed, buildReportEditsEmbed } from '../ui/embeds/report-edits.js';
import {
  buildActionSelect,
  buildButtons,
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

type StageResult = { ok: true } | { ok: false; message: string };

type CommitResult =
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

function isValidDiscordId(id: unknown): id is string {
  return typeof id === 'string' && /^\d{17,20}$/.test(id);
}

function cloneMatch(match: GetMatchResponse): GetMatchResponse {
  // Safe enough for our DTO shape (plain JSON)
  return JSON.parse(JSON.stringify(match)) as GetMatchResponse;
}

function mergeRecord(
  base: Record<number, string> | undefined,
  extra: Record<number, string> | undefined
): Record<number, string> | undefined {
  if (!base && !extra) return undefined;
  return { ...(base ?? {}), ...(extra ?? {}) };
}

export function parseDiscordIdMapping(
  raw: string,
  playerCount: number
): { assignments: Record<number, string>; errors: string[] } {
  const assignments: Record<number, string> = {};
  const errors: string[] = [];

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    errors.push('No mappings provided.');
    return { assignments, errors };
  }

  const seenSlots = new Set<number>();
  const seenIds = new Set<string>();

  for (const line of lines) {
    const m = /^([0-9]{1,2})\s*=\s*(.+)$/.exec(line);
    if (!m) {
      errors.push(`Invalid line: \`${line}\` (expected format: 1=@mention or 1=123...)`);
      continue;
    }

    const slotNum = Number(m[1]);
    const idx = slotNum - 1;
    if (!Number.isInteger(slotNum) || slotNum < 1 || slotNum > playerCount) {
      errors.push(`Slot ${m[1]} is out of range (1..${playerCount}).`);
      continue;
    }

    if (seenSlots.has(idx)) {
      errors.push(`Slot ${slotNum} is specified more than once.`);
      continue;
    }

    const parsed = parseDiscordUserId(m[2]);
    if (!parsed || !isValidDiscordId(parsed)) {
      errors.push(`Slot ${slotNum}: invalid Discord ID (@mention or numeric ID required).`);
      continue;
    }

    if (seenIds.has(parsed)) {
      errors.push(`Discord ID <@${parsed}> is assigned more than once.`);
      continue;
    }

    seenSlots.add(idx);
    seenIds.add(parsed);
    assignments[idx] = parsed;
  }

  return { assignments, errors };
}

function resetActionState(state: ReportEditsState): ReportEditsState {
  return {
    ...state,
    stage: 'ACTION',
    action: null,

    subInIndex: undefined,
    subOutDiscordId: undefined,

    removeSubIndex: undefined,

    discordIdBulkPending: undefined,

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

function ensureStaged(state: ReportEditsState): ReportEditsStagedChanges {
  return (state.staged ??= {});
}

function stageSubAssign(state: ReportEditsState): StageResult {
  if (typeof state.subInIndex !== 'number' || !state.subOutDiscordId) {
    return { ok: false, message: 'Select sub-in slot and sub-out user.' };
  }
  if (!isValidDiscordId(state.subOutDiscordId)) {
    return { ok: false, message: 'Invalid sub-out Discord ID.' };
  }

  const staged = ensureStaged(state);
  const map = (staged.subAssignByIndex ??= {});
  map[state.subInIndex] = state.subOutDiscordId;
  return { ok: true };
}

function stageRemoveSub(state: ReportEditsState): StageResult {
  if (typeof state.removeSubIndex !== 'number') {
    return { ok: false, message: 'Select a sub slot to remove.' };
  }
  const staged = ensureStaged(state);
  const list = (staged.removeSubIndexes ??= []);
  if (!list.includes(state.removeSubIndex)) list.push(state.removeSubIndex);
  return { ok: true };
}

function stageOrder(state: ReportEditsState): StageResult {
  if (!state.orderDraft) return { ok: false, message: 'Order draft is missing.' };
  const v = validateOrderDraft(state.orderDraft);
  if (!v.ok) return { ok: false, message: `${EMOJI_FAIL} ${v.message}` };

  const staged = ensureStaged(state);
  staged.orderDraft = JSON.parse(JSON.stringify(state.orderDraft)) as ReportEditsOrderDraft;
  return { ok: true };
}

function stageTrigger(state: ReportEditsState): StageResult {
  if (!state.triggerKind || !state.triggerDiscordId) {
    return { ok: false, message: 'Select a player.' };
  }
  if (!isValidDiscordId(state.triggerDiscordId)) {
    return { ok: false, message: 'Invalid Discord ID for trigger.' };
  }
  const staged = ensureStaged(state);
  const list = (staged.triggerToggles ??= []);
  if (!list.some((t) => t.kind === state.triggerKind && t.discordId === state.triggerDiscordId)) {
    list.push({ kind: state.triggerKind, discordId: state.triggerDiscordId });
  }
  return { ok: true };
}

function stageDiscordIds(state: ReportEditsState): StageResult {
  const pending = state.discordIdBulkPending;
  if (!pending || Object.keys(pending).length === 0) {
    return { ok: false, message: 'Enter one or more Discord IDs first.' };
  }

  const staged = ensureStaged(state);
  staged.discordIdByIndex = mergeRecord(staged.discordIdByIndex, pending);
  state.discordIdBulkPending = undefined;
  return { ok: true };
}

function applyDiscordIdsToMatch(
  match: GetMatchResponse,
  map: Record<number, string>
): void {
  for (const [k, v] of Object.entries(map)) {
    const idx = Number(k);
    if (!Number.isInteger(idx) || idx < 0 || idx >= match.players.length) continue;
    match.players[idx].discord_id = v;
  }
}

function applyOrderDraftToMatch(match: GetMatchResponse, draft: ReportEditsOrderDraft): void {
  // Match placements are 0-based internally; draft placements are 1-based.
  for (const p of match.players) {
    const placement = draft.placementsByTeamId[p.team];
    if (typeof placement === 'number') {
      p.placement = placement - 1;
    }
  }
}

export type ReportEditsBackend = {
  assignDiscordIdAll: typeof assignDiscordIdAll;
  assignSub: typeof assignSub;
  removeSub: typeof removeSub;
  triggerQuit: typeof triggerQuit;
  setPlacements: typeof setPlacements;
};

export async function commitStagedEditsCore(args: {
  matchId: string;
  baseMatch: GetMatchResponse;
  staged: ReportEditsStagedChanges;
  discordMessageId: string;
  backend: ReportEditsBackend;
}): Promise<CommitResult> {
  const { matchId, baseMatch, staged, discordMessageId, backend } = args;

  const hasAnything =
    Boolean(staged.orderDraft) ||
    Boolean(staged.discordIdByIndex && Object.keys(staged.discordIdByIndex).length) ||
    Boolean(staged.subAssignByIndex && Object.keys(staged.subAssignByIndex).length) ||
    Boolean(staged.removeSubIndexes && staged.removeSubIndexes.length) ||
    Boolean(staged.triggerToggles && staged.triggerToggles.length);

  if (!hasAnything) {
    return { ok: false, message: `${EMOJI_FAIL} No staged changes to apply.` };
  }

  // Pre-validate order
  if (staged.orderDraft) {
    const v = validateOrderDraft(staged.orderDraft);
    if (!v.ok) return { ok: false, message: `${EMOJI_FAIL} ${v.message}` };
  }

  // Pre-validate Discord IDs and decide commit strategy (prefer atomic assignDiscordIdAll)
  let discordIdList: string[] | null = null;
  if (staged.discordIdByIndex && Object.keys(staged.discordIdByIndex).length > 0) {
    const list: string[] = [];
    const missingSlots: number[] = [];

    for (let i = 0; i < baseMatch.players.length; i++) {
      const stagedId = staged.discordIdByIndex[i];
      const current = baseMatch.players[i]?.discord_id;
      const chosen = stagedId ?? (isValidDiscordId(current) ? current : undefined);
      if (!chosen) {
        missingSlots.push(i + 1);
        list.push('');
      } else {
        list.push(chosen);
      }
    }

    if (missingSlots.length > 0) {
      return {
        ok: false,
        message: `${EMOJI_FAIL} Missing Discord IDs for slots: ${missingSlots.join(
          ', '
        )}. Use “Enter IDs” to fill all missing slots, then Finish.`,
      };
    }

    discordIdList = list;
  }

  // Pre-validate sub indexes
  if (staged.subAssignByIndex) {
    for (const [k, v] of Object.entries(staged.subAssignByIndex)) {
      const idx = Number(k);
      if (!Number.isInteger(idx) || idx < 0 || idx >= baseMatch.players.length) {
        return { ok: false, message: `${EMOJI_FAIL} Invalid sub-in slot: ${k}.` };
      }
      if (!isValidDiscordId(v)) {
        return { ok: false, message: `${EMOJI_FAIL} Invalid sub-out Discord ID for slot ${idx + 1}.` };
      }
    }
  }

  if (staged.removeSubIndexes) {
    for (const idx of staged.removeSubIndexes) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= baseMatch.players.length) {
        return { ok: false, message: `${EMOJI_FAIL} Invalid remove-sub index: ${idx}.` };
      }
    }
  }

  if (staged.triggerToggles) {
    for (const t of staged.triggerToggles) {
      if (!isValidDiscordId(t.discordId)) {
        return { ok: false, message: `${EMOJI_FAIL} Invalid trigger Discord ID.` };
      }
    }
  }

  let updated: GetMatchResponse = baseMatch;

  try {
    if (discordIdList) {
      updated = await backend.assignDiscordIdAll(matchId, discordIdList, discordMessageId);
    }

    if (staged.subAssignByIndex) {
      for (const [k, v] of Object.entries(staged.subAssignByIndex)) {
        updated = await backend.assignSub(matchId, String(Number(k)), v, discordMessageId);
      }
    }

    if (staged.removeSubIndexes) {
      for (const idx of staged.removeSubIndexes) {
        updated = await backend.removeSub(matchId, String(idx), discordMessageId);
      }
    }

    if (staged.triggerToggles) {
      for (const t of staged.triggerToggles) {
        updated = await backend.triggerQuit(matchId, t.discordId, discordMessageId);
      }
    }

    if (staged.orderDraft) {
      const newOrder = buildNewOrderString(staged.orderDraft);
      updated = await backend.setPlacements(matchId, newOrder, discordMessageId);
    }

    return { ok: true, updated };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, message: `${EMOJI_FAIL} Failed to apply staged edits: ${msg}` };
  }
}

function canApply(state: ReportEditsState): boolean {
  switch (state.stage) {
    case 'SUB_ASSIGN':
      return typeof state.subInIndex === 'number' && Boolean(state.subOutDiscordId);
    case 'SUB_REMOVE':
      return typeof state.removeSubIndex === 'number';
    case 'DISCORD_ID':
      return Boolean(state.discordIdBulkPending && Object.keys(state.discordIdBulkPending).length);
    case 'ORDER':
      return Boolean(state.orderDraft && validateOrderDraft(state.orderDraft).ok);
    case 'TRIGGER':
      return Boolean(state.triggerKind && state.triggerDiscordId);
    default:
      return false;
  }
}

export function buildReportEditsSessionComponents(
  state: ReportEditsState,
  disableAll: boolean
): SessionRow[] {
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
    // Large-server safe: primary input is text-based via modal (Enter IDs).
    // No user-select dropdowns in this flow.
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
    staged: undefined,
    stage: 'ACTION',
    action: null,
    lastNotice: 'Choose an action to begin.',
  };

  function getRenderState(): ReportEditsState {
    const render: ReportEditsState = {
      ...state,
      match: cloneMatch(state.match),
    };

    const combinedDiscordIds = mergeRecord(
      state.staged?.discordIdByIndex,
      state.discordIdBulkPending
    );
    if (combinedDiscordIds) applyDiscordIdsToMatch(render.match, combinedDiscordIds);

    const draft =
      state.stage === 'ORDER' && state.orderDraft
        ? state.orderDraft
        : state.staged?.orderDraft;
    if (draft) applyOrderDraftToMatch(render.match, draft);

    return render;
  }

  const initialRender = getRenderState();
  await interaction.editReply({
    embeds: [buildReportEditsEmbed(initialRender)],
    components: buildReportEditsSessionComponents(initialRender, false),
  });

  const reply = (await interaction.fetchReply()) as Message;

  const collector = reply.createMessageComponentCollector({
    idle: REPORT_EDITS_COLLECTOR_IDLE_MS,
  });

  let finished = false;

  async function refresh(): Promise<void> {
    try {
      const render = getRenderState();
      await interaction.editReply({
        embeds: [buildReportEditsEmbed(render)],
        components: buildReportEditsSessionComponents(render, false),
      });
    } catch {
      // ignore
    }
  }

  async function endSession(reason: 'Finished' | 'Cancelled' | 'Timed out') {
    if (finished) return;
    finished = true;

    try {
      const render = getRenderState();
      await interaction.editReply({
        embeds: [buildFinishedReportEditsEmbed(render, reason)],
        components: buildReportEditsSessionComponents(render, true),
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
        .setTitle('Assign Discord IDs');

      const input = new TextInputBuilder()
        .setCustomId('discord_map')
        .setLabel('Mappings: slot=@mention or slot=ID')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(4000)
        .setPlaceholder('1=@Cisco\n3=123456789012345678');

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

        const raw = submitted.fields.getTextInputValue('discord_map');
        const { assignments, errors } = parseDiscordIdMapping(
          raw,
          state.match.players.length
        );

        await submitted.deferUpdate().catch(() => null);

        const count = Object.keys(assignments).length;
        if (count === 0) {
          state.discordIdBulkPending = undefined;
          state.lastNotice = `${EMOJI_FAIL} ${errors.join('\n')}`.slice(0, 1024);
          await refresh();
          return;
        }

        state.discordIdBulkPending = assignments;
        state.lastNotice =
          `${EMOJI_CONFIRM} Loaded ${count} Discord ID mapping(s). Click Apply to stage them.` +
          (errors.length ? `\n${EMOJI_FAIL} ${errors.join('\n')}` : '');
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
        state.lastNotice =
          'Click “Enter IDs” and paste mappings like `1=@mention` or `3=123...` (one per line). Then click Apply to stage.';
      } else if (action === 'ORDER') {
        state.stage = 'ORDER';
        const d = computeOrderDraft(state.match.players);
        if (!d.ok) state.lastNotice = `${EMOJI_FAIL} ${d.message}`;
        else {
          state.orderDraft = d.draft;
          state.lastNotice =
            'Select a placement, then select a team/player to swap into that place. Click Apply to stage.';
        }
      } else if (action === 'TRIGGER_QUIT' || action === 'TRIGGER_LAGGER') {
        state.stage = 'TRIGGER';
        state.triggerKind = action === 'TRIGGER_LAGGER' ? 'lagger' : 'quit';
        state.lastNotice = 'Select a player, then click Apply to stage.';
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
      state.lastNotice = 'Draft updated. Click Apply to stage.';
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
      state.staged = undefined;
      state.discordIdBulkPending = undefined;
      state.lastNotice = 'Cancelled.';
      await endSession('Cancelled');
      return;
    }

    if (i.customId === REPORT_EDITS_CID.finish) {
      state.lastNotice = 'Committing staged edits…';
      await refresh();

      const staged = state.staged;
      if (!staged) {
        state.lastNotice = `${EMOJI_FAIL} No staged changes to apply.`;
        await refresh();
        return;
      }

      const audit = await postAuditMessage(
        interaction,
        `Applying report edits…\nMatch ID: **${state.matchId}**`
      );
      if (!audit) {
        state.lastNotice = `${EMOJI_FAIL} Failed to post audit message. Edit aborted.`;
        await refresh();
        return;
      }

      const result = await commitStagedEditsCore({
        matchId: state.matchId,
        baseMatch: state.match,
        staged,
        discordMessageId: audit.id,
        backend: {
          assignDiscordIdAll,
          assignSub,
          removeSub,
          triggerQuit,
          setPlacements,
        },
      });

      if (!result.ok) {
        state.lastNotice = result.message;
        await audit.edit(result.message).catch(() => null);
        await refresh();
        return;
      }

      const header =
        `${EMOJI_CONFIRM} Report edits applied by <@${interaction.user.id}>\n` +
        `Match ID: **${result.updated.match_id}**\n`;
      await audit
        .edit(truncateForDiscord(header + convertMatchToStr(result.updated as BaseReport, false)))
        .catch(() => null);

      await updatePublicReportMessage(interaction, result.updated);

      state.match = result.updated;
      state.staged = undefined;
      state.discordIdBulkPending = undefined;
      state = resetActionState(state);
      state.lastNotice = `${EMOJI_CONFIRM} Changes committed.`;
      await refresh();
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
      state.lastNotice = 'Staging…';
      await refresh();

      let result: StageResult;
      if (state.stage === 'SUB_ASSIGN') {
        result = stageSubAssign(state);
      } else if (state.stage === 'SUB_REMOVE') {
        result = stageRemoveSub(state);
      } else if (state.stage === 'DISCORD_ID') {
        result = stageDiscordIds(state);
      } else if (state.stage === 'ORDER') {
        result = stageOrder(state);
      } else if (state.stage === 'TRIGGER') {
        result = stageTrigger(state);
      } else {
        result = { ok: false, message: 'Choose an action first.' };
      }

      if (!result.ok) {
        state.lastNotice = result.message;
        await refresh();
        return;
      }

      state = resetActionState(state);
      state.lastNotice = `${EMOJI_CONFIRM} Staged. Run another edit, or Finish.`;
      await refresh();
      return;
    }
  });

  collector.on('end', async (_collected, reason) => {
    if (finished) return;
    if (reason === 'Finished' || reason === 'Cancelled') return;
    state.staged = undefined;
    state.discordIdBulkPending = undefined;
    state.lastNotice = 'Timed out.';
    await endSession('Timed out');
  });
}