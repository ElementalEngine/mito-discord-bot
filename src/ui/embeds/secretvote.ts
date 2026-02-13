import { EmbedBuilder } from 'discord.js';

import type { SecretVoteStatus } from '../../types/secretvote.js';

const MAX_FIELD = 1024;

function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function formatVoterLines(status: SecretVoteStatus): string {
  const lines = status.voters.map((v) => {
    const isAwaiting = status.awaitingIds.has(v.id);
    const label = status.isFinal
      ? isAwaiting
        ? 'No response (counted as YES)'
        : 'Voted'
      : status.votedIds.has(v.id)
        ? 'Voted'
        : 'Awaiting vote';

    return `• <@${v.id}> — ${label}`;
  });

  return clamp(lines.join('\n') || '—', MAX_FIELD);
}

function formatNonVoters(nonVoterIds: readonly string[]): string {
  if (nonVoterIds.length === 0) return '—';
  return clamp(nonVoterIds.map((id) => `• <@${id}>`).join('\n'), MAX_FIELD);
}

export function buildSecretVoteEmbed(status: SecretVoteStatus): EmbedBuilder {
  const startedTs = Math.floor(status.startedAtMs / 1000);
  const endsTs = Math.floor(status.endsAtMs / 1000);

  const lines: string[] = [
    `**Action:** ${status.action}`,
    `**Turn:** ${status.turn}`,
    '',
    `**Details:** ${clamp(status.details.trim() || '—', 900)}`,
    '',
    `Started by <@${status.hostId}>`,
  ];

  if (status.isFinal) {
    // No relative timestamps in the final state (prevents “Ends X hours ago”).
    lines.push(`Vote ended • Ended at <t:${endsTs}:f>`);
  } else {
    lines.push(`Voting ends <t:${endsTs}:R> (started <t:${startedTs}:R>)`);
  }

  const e = new EmbedBuilder()
    .setTitle('🔒 Secret Vote')
    .setDescription(lines.join('\n'))
    .addFields({ name: 'Voters', value: formatVoterLines(status) });

  if (status.isFinal && status.result) {
    const { yes, no, outcome, nonVoterIds, rule, notes } = status.result;
    e.addFields(
      {
        name: 'Results',
        value: `YES: **${yes}**\nNO: **${no}**\nOutcome: **${outcome}**\nRule: ${rule}`,
      },
      {
        name: 'No response (counted as YES)',
        value: formatNonVoters(nonVoterIds),
      }
    );

    if (notes && notes.length > 0) {
      e.addFields({ name: 'Notes', value: clamp(notes.join('\n'), MAX_FIELD) });
    }
  } else {
    e.setFooter({
      text: 'Voting is by DM. If you don’t vote before the timer ends, you’ll be counted as YES.',
    });
  }

  return e;
}
