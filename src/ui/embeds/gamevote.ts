import { EmbedBuilder } from 'discord.js';

import type { DraftGameType } from '../../types/draft.js';
import type { CivEdition } from '../../config/types.js';
import type { Civ7StartingAge } from '../../data/types.js';
import type { GameVotePhase, GameVoteProgress, GameVoteStatus } from '../../types/gamevote.js';

const MAX_FIELD_VALUE = 1024;
const MAX_FIELD_NAME = 256;

function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function fmtEdition(e: CivEdition): string {
  return e === 'CIV6' ? 'Civ6' : 'Civ7';
}

function fmtStatus(status: GameVoteStatus, phase: GameVotePhase): string {
  if (status === 'timed_out') return 'Closed (Inactivity/Timeout)';
  if (phase === 'blind_draft') return 'In Progress';
  if (status === 'completed') return 'Completed';
  return 'In Progress';
}

function fmtTimerLines(startedAtMs: number, autoCloseAtMs: number): readonly string[] {
  const started = Math.floor(startedAtMs / 1000);
  const autoClose = Math.floor(autoCloseAtMs / 1000);

  return [
    `**Started:** <t:${started}:t> (<t:${started}:R>)`,
    `**Auto-close:** <t:${autoClose}:t> (<t:${autoClose}:R>)`,
  ];
}

function renderVoters(p: GameVoteProgress): string {
  const lines = p.voters.map((v) => {
    const finished = p.finishedIds.has(v.id);
    const answered = p.answeredCountById.get(v.id) ?? 0;
    const total = p.totalQuestions;
    const bansDone = p.bansSubmittedIds.has(v.id);
    const bansSuffix = bansDone ? ' • bans ✅' : '';

    let status = `${answered}/${total} completed${bansSuffix}`;

    if (p.phase === 'blind_draft') {
      status = p.blindDraftPickedIds.has(v.id)
        ? `Vote done • blind pick ✅${bansSuffix}`
        : finished
          ? `Vote done • blind pick pending${bansSuffix}`
          : `${answered}/${total} completed${bansSuffix}`;
    } else if (p.status === 'timed_out') {
      status = `${answered}/${total} completed${bansSuffix}`;
    } else if (finished) {
      status = `Done${bansSuffix}`;
    }

    return `• <@${v.id}> — ${status}`;
  });

  return clamp(lines.join('\n') || '—', MAX_FIELD_VALUE);
}

export type GameVoteQuestionField = Readonly<{ name: string; value: string; inline?: boolean }>;

export function buildGameVoteEmbed(args: Readonly<{
  edition: CivEdition;
  gameType: DraftGameType;
  startingAge?: Civ7StartingAge;
  phase: GameVotePhase;
  status: GameVoteStatus;
  nowMs: number;
  startedAtMs: number;
  autoCloseAtMs: number;
  progress: GameVoteProgress;
  questionFields?: readonly GameVoteQuestionField[];
}>): EmbedBuilder {
  const title = `🗳️ Game Vote — ${fmtEdition(args.edition)}`;

  const meta: string[] = [
    `**Game Type:** ${args.gameType}`,
    args.edition === 'CIV7' ? `**Starting Age:** ${args.startingAge ?? '—'}` : undefined,
    `**State:** ${fmtStatus(args.status, args.phase)}`,
    ...fmtTimerLines(args.startedAtMs, args.autoCloseAtMs),
  ].filter(Boolean) as string[];

  const e = new EmbedBuilder()
    .setTitle(title)
    .setDescription(meta.join('\n'))
    .addFields({ name: 'Voters', value: renderVoters(args.progress) });

  if (args.questionFields && args.questionFields.length > 0) {
    e.addFields(
      ...args.questionFields.map((f) => ({
        name: clamp(f.name, MAX_FIELD_NAME),
        value: clamp(f.value, MAX_FIELD_VALUE),
        inline: f.inline ?? false,
      }))
    );
  }

  return e;
}
