import { EmbedBuilder } from 'discord.js';

import { buildReportEmbed } from '../layouts/report.layout.js';
import type { ReportEditsState } from '../../types/report-edits.js';
import { summarizeOrderDraft } from '../components/report-edits.js';

export function buildReportEditsEmbed(state: ReportEditsState): EmbedBuilder {
  const base = buildReportEmbed(state.match, {
    reporterId: state.initiatorId,
    header: 'Report Edits',
  });

  const notice = state.lastNotice;
  const hasNotice = Boolean(notice && notice.trim().length);

  if (state.stage === 'ORDER' && state.orderDraft) {
    base.addFields({
      name: 'Order Draft',
      value: summarizeOrderDraft(state.orderDraft),
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
