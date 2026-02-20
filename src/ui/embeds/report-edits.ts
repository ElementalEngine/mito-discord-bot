import { EmbedBuilder } from 'discord.js';

import { buildReportEmbed } from '../layouts/report.layout.js';
import type { ReportEditsState } from '../../types/report-edits.js';

function ordinal(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n}st`;
  if (mod10 === 2 && mod100 !== 12) return `${n}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${n}rd`;
  return `${n}th`;
}

function formatOrderPreview(state: ReportEditsState): string {
  const draft = state.orderDraft;
  if (!draft) return '';

  const max = draft.teamIds.length;
  const byPlacement: Record<number, number> = {};
  for (const teamId of draft.teamIds) {
    const p = draft.placementsByTeamId[teamId];
    if (typeof p === 'number') byPlacement[p] = teamId;
  }

  const lines: string[] = [];
  for (let place = 1; place <= max; place++) {
    const teamId = byPlacement[place];
    if (typeof teamId !== 'number') {
      lines.push(`${ordinal(place)} — _unset_`);
      continue;
    }

    if (draft.kind === 'team') {
      lines.push(`${ordinal(place)} — Team ${teamId + 1}`);
      continue;
    }

    const p = state.match.players.find((x) => x.team === teamId);
    const name = p?.discord_id ? `<@${p.discord_id}>` : p?.user_name ?? `Player ${teamId + 1}`;
    lines.push(`${ordinal(place)} — ${name}`);
  }

  return lines.join('\n').slice(0, 1024);
}

function formatDiscordIdPreview(state: ReportEditsState): string {
  const missing = state.match.players
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => !p.discord_id);

  if (missing.length === 0) return 'All slots have Discord IDs.';

  const lines: string[] = [];
  for (const { p, idx } of missing) {
    const name = p.user_name ?? 'Unknown';
    const isSelected = state.discordIdSlotIndex === idx;
    const pending =
      isSelected && state.discordIdPending ? ` → <@${state.discordIdPending}>` : '';
    lines.push(`#${idx + 1} ${name}${pending}`);
  }

  return lines.join('\n').slice(0, 1024);
}

export function buildReportEditsEmbed(state: ReportEditsState): EmbedBuilder {
  const base = buildReportEmbed(state.match, {
    reporterId: state.initiatorId,
    header: 'Report Edits',
  });

  const notice = state.lastNotice;
  const hasNotice = Boolean(notice && notice.trim().length);

  if (state.stage === 'ORDER' && state.orderDraft) {
    base.addFields({ name: 'Pending Order', value: formatOrderPreview(state), inline: false });
  }

  if (state.stage === 'DISCORD_ID') {
    base.addFields({
      name: 'Missing Discord IDs',
      value: formatDiscordIdPreview(state),
      inline: false,
    });
  }

  if (hasNotice) {
    base.addFields({
      name: 'Status',
      value: notice!.slice(0, 1024),
      inline: false,
    });
  }

  return base;
}

export function buildFinishedReportEditsEmbed(
  state: ReportEditsState,
  status: 'Finished' | 'Cancelled' | 'Timed out'
): EmbedBuilder {
  const embed = buildReportEditsEmbed({ ...state, lastNotice: `Session ${status}.` });
  embed.setFooter({ text: `Report Edits — ${status}` });
  return embed;
}
