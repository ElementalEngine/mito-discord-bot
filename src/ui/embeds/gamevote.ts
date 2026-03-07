import { EmbedBuilder } from 'discord.js';

import type { DraftGameType } from '../../types/draft.js';
import type { CivEdition } from '../../config/types.js';
import type { Civ7StartingAge } from '../../data/types.js';
import type { GameVoteProgress, GameVoteStatus } from '../../types/gamevote.js';

const MAX_FIELD_VALUE = 1024;
const MAX_FIELD_NAME = 256;

function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function fmtEdition(e: CivEdition): string {
  return e === 'CIV6' ? 'Civ6' : 'Civ7';
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

function fmtTimerLines(startedAtMs: number, endsAtMs: number): readonly string[] {
  const durationMinutes = Math.max(1, Math.round((endsAtMs - startedAtMs) / 60_000));
  return [
    `**Started:** ${fmtTimeOnly(startedAtMs)}`,
    `**Ends:** ${fmtTimeOnly(endsAtMs)} (${durationMinutes} minutes)`,
  ];
}

function renderVoters(p: GameVoteProgress): string {
  const total = p.totalQuestions;

  const lines = p.voters.map((voter) => {
    const answered = p.answeredCountById.get(voter.id) ?? 0;
    const voteStatus = p.voteSubmittedIds.has(voter.id) ? 'Game Vote ✅' : `Game Vote ${answered}/${total}`;
    const leaderBanStatus = `Leader bans ${p.bansSubmittedIds.has(voter.id) ? '✅' : '❌'}`;
    const civBanStatus =
      p.edition === 'CIV7' ? ` | Civ bans ${p.bansSubmittedIds.has(voter.id) ? '✅' : '❌'}` : '';
    const completedStatus = ` | Completed ${p.finishedIds.has(voter.id) ? '✅' : '❌'}`;
    return `• <@${voter.id}> — ${voteStatus} | ${leaderBanStatus}${civBanStatus}${completedStatus}`;
  });

  return clamp(lines.join('\n') || '—', MAX_FIELD_VALUE);
}

export type GameVoteQuestionField = Readonly<{ name: string; value: string; inline?: boolean }>;

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
  const title = `🗳️ Game Vote — ${fmtEdition(args.edition)}`;

  const meta: string[] = [
    `**Game Type:** ${args.gameType}`,
    args.edition === 'CIV7' ? `**Starting Age:** ${args.startingAge ?? '—'}` : undefined,
    `**State:** ${fmtStatus(args.status)}`,
    ...fmtTimerLines(args.startedAtMs, args.endsAtMs),
  ].filter(Boolean) as string[];

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(meta.join('\n'))
    .addFields({ name: 'Voters', value: renderVoters(args.progress) });

  if (args.questionFields && args.questionFields.length > 0) {
    embed.addFields(
      ...args.questionFields.map((field) => ({
        name: clamp(field.name, MAX_FIELD_NAME),
        value: clamp(field.value, MAX_FIELD_VALUE),
        inline: field.inline ?? false,
      }))
    );
  }

  return embed;
}
