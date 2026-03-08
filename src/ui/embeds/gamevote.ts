import { EmbedBuilder, userMention } from 'discord.js';

import { GAMEVOTE_CPL_STANDARD_RULES } from '../../config/constants.js';

import type { CivEdition } from '../../config/types.js';
import type { Civ7StartingAge } from '../../data/types.js';
import type { DraftGameType } from '../../types/draft.js';
import type { GameVoteProgress, GameVoteStatus } from '../../types/gamevote.js';

const MAX_FIELD_VALUE = 1024;
const MAX_FIELD_NAME = 256;

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

function fmtCompletedTimerLine(startedAtMs: number, completedAtMs: number): string {
  const durationMinutes = Math.max(1, Math.round((completedAtMs - startedAtMs) / 60_000));
  return `**Started:** ${fmtTimeOnly(startedAtMs)} ~ **Completed:** ${fmtTimeOnly(completedAtMs)} (${durationMinutes} minutes)`;
}

function formatVoterName(displayName: string, userId?: string): string {
  if (userId) return userMention(userId);
  const normalized = displayName.replace(/[\r\n]+/g, ' ').trim() || 'Unknown';
  return normalized.startsWith('@') ? normalized : `@${normalized}`;
}

function buildVoterField(progress: GameVoteProgress): EmbedField {
  const lines = progress.voters.map((voter) => {
    const name = formatVoterName(voter.displayName, voter.id);
    if (progress.status === 'closed') {
      return `${name} — ${progress.finishedIds.has(voter.id) ? 'Completed' : 'Incomplete vote'}`;
    }
    return `${name} — ${progress.finishedIds.has(voter.id) ? 'Completed' : 'Awaiting Vote'}`;
  });

  let visible = lines.length;
  let value = lines.join('\n') || '—';

  while (value.length > MAX_FIELD_VALUE && visible > 1) {
    visible -= 1;
    const hidden = lines.length - visible;
    value = [...lines.slice(0, visible), `… (+${hidden} more)`].join('\n');
  }

  return {
    name: 'Voters',
    value: clamp(value, MAX_FIELD_VALUE),
    inline: false,
  };
}

function buildStandardRulesField(): EmbedField {
  return {
    name: 'CPL Standard Rules',
    value: GAMEVOTE_CPL_STANDARD_RULES.map((line: string) => `• ${line}`).join('\n'),
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
  completedAtMs?: number | null;
  progress: GameVoteProgress;
  questionFields?: readonly GameVoteQuestionField[];
}>): EmbedBuilder {
  const meta: string[] = [
    `**Game Type:** ${args.gameType}`,
    args.edition === 'CIV7' ? `**Starting Age:** ${args.startingAge ?? '—'}` : undefined,
    `**State:** ${fmtStatus(args.status)}`,
    args.status === 'closed'
      ? undefined
      : args.status === 'completed' && args.completedAtMs
        ? fmtCompletedTimerLine(args.startedAtMs, args.completedAtMs)
        : fmtTimerLine(args.startedAtMs, args.endsAtMs),
  ].filter((line): line is string => Boolean(line));

  const embed = new EmbedBuilder()
    .setTitle(`🗳️ Game Vote — ${fmtEdition(args.edition)}`)
    .setDescription(meta.join('\n'));

  if (args.status === 'in_progress') {
    embed.setFooter({
      text: '⚠️ Once you press Finish Vote or Randomize My Vote, your vote is finalized and committed to the game setup. ⚠️',
    });
  }

  const voterField = buildVoterField(args.progress);
  embed.addFields({
    name: clamp(voterField.name, MAX_FIELD_NAME),
    value: clamp(voterField.value, MAX_FIELD_VALUE),
    inline: false,
  });

  if (args.questionFields && args.questionFields.length > 0) {
    embed.addFields(
      ...args.questionFields.map((field) => ({
        name: clamp(field.name, MAX_FIELD_NAME),
        value: clamp(field.value, MAX_FIELD_VALUE),
        inline: field.inline ?? false,
      })),
    );
  }

  if (args.status !== 'closed') {
    const rulesField = buildStandardRulesField();
    embed.addFields({
      name: clamp(rulesField.name, MAX_FIELD_NAME),
      value: clamp(rulesField.value, MAX_FIELD_VALUE),
      inline: false,
    });
  }

  return embed;
}
