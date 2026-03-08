import { EmbedBuilder, userMention } from 'discord.js';

import type { CivEdition } from '../../config/types.js';
import type { Civ7StartingAge } from '../../data/types.js';
import type { DraftGameType } from '../../types/draft.js';
import type { GameVoteProgress, GameVoteStatus } from '../../types/gamevote.js';

const MAX_FIELD_VALUE = 1024;
const MAX_FIELD_NAME = 256;
const BLANK = '​';

export type GameVoteQuestionField = Readonly<{ name: string; value: string; inline?: boolean }>;

type EmbedField = Readonly<{ name: string; value: string; inline?: boolean }>;

function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function fmtEdition(edition: CivEdition): string {
  return edition === 'CIV6' ? 'Civ6' : 'Civ7';
}

function fmtStatus(status: GameVoteStatus): string {
  if (status === 'completed') return 'Completed';
  if (status === 'closed') return 'Closed (Inactivity/Timeout)';
  return 'In Progress';
}

function fmtTimeOnly(ms: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ms));
}

function fmtTimerLine(startedAtMs: number, endsAtMs: number): string {
  const durationMinutes = Math.max(1, Math.round((endsAtMs - startedAtMs) / 60_000));
  return `**Started:** ${fmtTimeOnly(startedAtMs)} ~ **Ends:** ${fmtTimeOnly(endsAtMs)} (${durationMinutes} minutes)`;
}

const FIGURE_SPACE = ' ';

function formatVoterName(displayName: string, userId?: string): string {
  if (userId) return userMention(userId);
  const normalized = displayName.replace(/[\r\n]+/g, ' ').trim() || 'Unknown';
  return normalized.startsWith('@') ? normalized : `@${normalized}`;
}

function padFigure(text: string, width: number): string {
  if (text.length >= width) return text;
  return `${text}${FIGURE_SPACE.repeat(width - text.length)}`;
}

function questionCell(progress: GameVoteProgress, voterId: string): string {
  if (progress.voteSubmittedIds.has(voterId)) return '✅';
  const answered = progress.answeredCountById.get(voterId) ?? 0;
  return `${answered}/${progress.totalQuestions}`;
}

function leaderBansCell(progress: GameVoteProgress, voterId: string): string {
  const count = progress.leaderBanCountById.get(voterId) ?? 0;
  return count > 0 ? String(count) : '-';
}

function civBansCell(progress: GameVoteProgress, voterId: string): string {
  const count = progress.civBanCountById.get(voterId) ?? 0;
  return count > 0 ? String(count) : '-';
}

function finishedCell(progress: GameVoteProgress, voterId: string): string {
  return progress.finishedIds.has(voterId) ? '✅' : '-';
}

function buildActiveStatusFields(progress: GameVoteProgress): readonly EmbedField[] {
  const voters = progress.voters.map((voter) => formatVoterName(voter.displayName, voter.id));
  const statuses = progress.voters.map((voter) => {
    const gap = `${FIGURE_SPACE}${FIGURE_SPACE}`;
    const question = padFigure(questionCell(progress, voter.id), 4);
    const leaderBans = padFigure(leaderBansCell(progress, voter.id), progress.edition === 'CIV7' ? 2 : 3);
    const finished = padFigure(finishedCell(progress, voter.id), 1);
    if (progress.edition === 'CIV7') {
      const civBans = padFigure(civBansCell(progress, voter.id), 2);
      return [question, leaderBans, civBans, finished].join(gap);
    }
    return [question, leaderBans, finished].join(gap);
  });

  let visible = voters.length;
  let voterText = voters.join('\n') || '—';
  let statusText = statuses.join('\n') || '—';

  while ((voterText.length > MAX_FIELD_VALUE || statusText.length > MAX_FIELD_VALUE) && visible > 1) {
    visible -= 1;
    const hidden = voters.length - visible;
    voterText = [...voters.slice(0, visible), `… (+${hidden} more)`].join('\n');
    statusText = [...statuses.slice(0, visible), `… (+${hidden} more)`].join('\n');
  }

  return [
    { name: 'Voters', value: clamp(voterText, MAX_FIELD_VALUE), inline: true },
    {
      name:
        progress.edition === 'CIV7'
          ? '❓ Q | 🇱 Bans | 🇨 Bans | ➕ Vote'
          : '❓ Q | 🇱 Bans | ➕ Vote',
      value: clamp(statusText, MAX_FIELD_VALUE),
      inline: true,
    },
    { name: BLANK, value: BLANK, inline: false },
  ];
}

function buildClosedVoterField(progress: GameVoteProgress): EmbedField {
  const lines = progress.voters.map((voter) => {
    const state = progress.finishedIds.has(voter.id) ? 'Completed' : 'Incomplete vote';
    return `${formatVoterName(voter.displayName, voter.id)} — ${state}`;
  });

  return {
    name: 'Voters',
    value: clamp(lines.join('\n') || '—', MAX_FIELD_VALUE),
    inline: false,
  };
}

export function buildGameVoteEmbed(args: Readonly<{
  edition: CivEdition;
  gameType: DraftGameType;
  startingAge?: Civ7StartingAge;
  status: GameVoteStatus;
  startedAtMs: number;
  endsAtMs: number;
  progress: GameVoteProgress;
  questionFields?: readonly GameVoteQuestionField[];
}>): EmbedBuilder {
  const meta: string[] = [
    `**Game Type:** ${args.gameType}`,
    args.edition === 'CIV7' ? `**Starting Age:** ${args.startingAge ?? '—'}` : undefined,
    `**State:** ${fmtStatus(args.status)}`,
    args.status === 'closed' ? undefined : fmtTimerLine(args.startedAtMs, args.endsAtMs),
  ].filter((line): line is string => Boolean(line));

  const embed = new EmbedBuilder()
    .setTitle(`🗳️ Game Vote — ${fmtEdition(args.edition)}`)
    .setDescription(meta.join('\n'));

  if (args.status === 'closed') {
    const closed = buildClosedVoterField(args.progress);
    embed.addFields({
      name: clamp(closed.name, MAX_FIELD_NAME),
      value: clamp(closed.value, MAX_FIELD_VALUE),
      inline: false,
    });
  } else {
    embed.addFields(
      ...buildActiveStatusFields(args.progress).map((field) => ({
        name: clamp(field.name, MAX_FIELD_NAME),
        value: clamp(field.value, MAX_FIELD_VALUE),
        inline: field.inline ?? false,
      })),
    );
  }

  if (args.questionFields && args.questionFields.length > 0) {
    embed.addFields(
      ...args.questionFields.map((field) => ({
        name: clamp(field.name, MAX_FIELD_NAME),
        value: clamp(field.value, MAX_FIELD_VALUE),
        inline: field.inline ?? false,
      })),
    );
  }

  return embed;
}
