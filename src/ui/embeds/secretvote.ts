import { EmbedBuilder } from 'discord.js';

import type { SecretVoteStatus } from '../../types/secretvote.js';

const MAX_FIELD = 1024;

function clampField(text: string): string {
  if (text.length <= MAX_FIELD) return text;
  return `${text.slice(0, MAX_FIELD - 1)}…`;
}

function clampDetails(text: string): string {
  const t = text.trim();
  if (t.length <= 900) return t;
  return `${t.slice(0, 899)}…`;
}

function formatVoterLines(status: SecretVoteStatus): string {
  const lines = status.voters.map((v) => {
    const isVoted = status.votedIds.has(v.id);
    const label = status.isFinal
      ? status.awaitingIds.has(v.id)
        ? 'Auto-YES (no vote)'
        : 'Voted'
      : isVoted
        ? 'Voted'
        : 'Awaiting vote';

    return `• <@${v.id}> — ${label}`;
  });

  return clampField(lines.join('\n') || '—');
}

function formatNonVoters(nonVoterIds: readonly string[]): string {
  if (nonVoterIds.length === 0) return '—';
  return clampField(nonVoterIds.map((id) => `• <@${id}>`).join('\n'));
}

export function buildSecretVoteEmbed(status: SecretVoteStatus): EmbedBuilder {
  const startedTs = Math.floor(status.startedAtMs / 1000);
  const endsTs = Math.floor(status.endsAtMs / 1000);

  const e = new EmbedBuilder()
    .setTitle('🔒 Secret Vote')
    .setDescription(
      [
        `**Action:** ${status.action}`,
        `**Turn:** ${status.turn}`,
        '',
        `**Details:** ${clampDetails(status.details)}`,
        '',
        `Started by <@${status.hostId}>`,
        `Ends <t:${endsTs}:R> (started <t:${startedTs}:R>)`,
      ].join('\n')
    )
    .addFields({ name: 'Voters', value: formatVoterLines(status) });

  if (status.isFinal && status.result) {
    const { yes, no, outcome, nonVoterIds } = status.result;
    e.addFields(
      { name: 'Results', value: `YES: **${yes}**\nNO: **${no}**\nOutcome: **${outcome}**` },
      { name: 'Auto-YES (no vote)', value: formatNonVoters(nonVoterIds) }
    );
  } else {
    e.setFooter({ text: 'Votes are private (DM). No vote = YES at timeout.' });
  }

  return e;
}
