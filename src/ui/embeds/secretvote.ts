import { EmbedBuilder } from 'discord.js';

import type { SecretVoteStatus } from '../../types/secretvote.js';

const MAX_FIELD = 1024;
const VOTE_DURATION_MS = 2 * 60_000;

function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function fmt2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatElapsedMs(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${fmt2(minutes)}:${fmt2(seconds)}`;
}

function formatVoterLines(status: SecretVoteStatus): string {
  const lines = status.voters.map((v) => {
    const isAwaiting = status.awaitingIds.has(v.id);
    const label = status.isFinal
      ? isAwaiting
        ? 'No response'
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

function formatRuleBlock(rule: string): string {
  const idx = rule.indexOf(':');
  if (idx === -1) return `**Rule**\n${rule}`;

  const head = rule.slice(0, idx).trim();
  let rest = rule.slice(idx + 1).trim();
  if (rest && !rest.startsWith('•')) rest = `• ${rest}`;
  return `**Rule: ${head || '—'}**\n${rest || '—'}`;
}

export function buildSecretVoteEmbed(status: SecretVoteStatus): EmbedBuilder {
  const nowMs = status.nowMs ?? Date.now();
  const elapsedMs = Math.min(
    Math.max(nowMs - status.startedAtMs, 0),
    VOTE_DURATION_MS
  );
  const elapsed = formatElapsedMs(elapsedMs);

  const lines: string[] = [
    `**Action:** ${status.action}`,
    `**Turn:** ${status.turn}`,
    `**Details:** ${clamp(status.details.trim() || '—', 900)}`,
    '',
    `Started by <@${status.hostId}>`,
  ];

  if (status.isFinal) {
    lines.push('Vote ended');
  } else {
    lines.push('You have 2 minutes to vote.');
    lines.push(`Elapsed: \`${elapsed} / 02:00\``);
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
        value:
          `YES: **${yes}**\n` +
          `NO: **${no}**\n` +
          `Outcome: **${outcome}**\n` +
          `${formatRuleBlock(rule)}`,
      },
      {
        name: 'No response (counted as YES)',
        value: formatNonVoters(nonVoterIds),
      }
    );

    if (notes && notes.length > 0) {
      if (status.action === 'Irrel') {
        e.addFields({
          name: 'Eligibility (host verify)',
          value: clamp(notes.join('\n'), MAX_FIELD),
        });
      } else if (outcome === 'PASSED') {
        e.addFields({ name: 'Notes', value: clamp(notes.join('\n'), MAX_FIELD) });
      }
    }
  } else {
    e.setFooter({
      text: 'Voting happens in DMs. If you don’t vote before the timer ends, you’ll be counted as YES.',
    });
  }

  return e;
}
