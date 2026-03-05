import { EmbedBuilder } from 'discord.js';

import type { VoteQuestion } from '../../types/config.js';
import type { DraftGameType } from '../../types/draft.js';
import type { CivEdition, Civ7StartingAge } from '../../types/data.js';
import type { GameVotePhase, GameVoteProgress } from '../../types/gamevote.js';

const MAX_FIELD = 1024;

function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function fmtEdition(e: CivEdition): string {
  return e === 'CIV6' ? 'Civ6' : 'Civ7';
}

function fmtPhase(p: GameVotePhase): string {
  if (p === 'voting') return 'Voting';
  if (p === 'bans') return 'Bans';
  if (p === 'blind_draft') return 'Blind Draft';
  return 'Final';
}

function fmtTime(endsAtMs: number, nowMs: number): string {
  const ends = Math.floor(endsAtMs / 1000);
  const now = Math.floor(nowMs / 1000);
  if (ends <= now) return 'Ended';
  return `Ends <t:${ends}:R>`;
}

function renderVoters(p: GameVoteProgress): string {
  const lines = p.voters.map((v) => {
    const finished = p.finishedIds.has(v.id);
    const answered = p.answeredCountById.get(v.id) ?? 0;
    const total = p.totalQuestions;

    const status =
      p.phase === 'bans'
        ? finished
          ? 'Finished'
          : p.bansSubmittedIds.has(v.id)
            ? 'Bans submitted'
            : 'Awaiting'
        : p.phase === 'blind_draft'
          ? p.blindDraftPickedIds.has(v.id)
            ? 'Picked'
            : 'Awaiting pick'
          : finished
            ? 'Finished'
            : `${answered}/${total}`;

    return `• <@${v.id}> — ${status}`;
  });

  return clamp(lines.join('\n') || '—', MAX_FIELD);
}

function renderCurrentQuestion(q: VoteQuestion | null, index: number, total: number): string {
  if (!q) return '—';
  return `(${index + 1}/${total}) **${q.title}**`;
}

export function buildGameVoteEmbed(args: Readonly<{
  edition: CivEdition;
  gameType: DraftGameType;
  startingAge?: Civ7StartingAge;
  phase: GameVotePhase;
  nowMs: number;
  endsAtMs: number;
  currentQuestion: VoteQuestion | null;
  questionIndex: number;
  totalQuestions: number;
  settingsLines: readonly string[];
  progress: GameVoteProgress;
}>): EmbedBuilder {
  const title = `🗳️ Game Vote — ${fmtEdition(args.edition)}`;

  const meta: string[] = [
    `**Game Type:** ${args.gameType}`,
    args.edition === 'CIV7'
      ? `**Starting Age:** ${args.startingAge ?? '—'}`
      : undefined,
    `**Phase:** ${fmtPhase(args.phase)}`,
    `**Timer:** ${fmtTime(args.endsAtMs, args.nowMs)}`,
  ].filter(Boolean) as string[];

  const e = new EmbedBuilder()
    .setTitle(title)
    .setDescription(meta.join('\n'))
    .addFields({ name: 'Voters', value: renderVoters(args.progress) });

  if (args.phase === 'voting') {
    e.addFields({
      name: 'Current Question',
      value: renderCurrentQuestion(args.currentQuestion, args.questionIndex, args.totalQuestions),
    });
  }

  if (args.settingsLines.length > 0) {
    e.addFields({
      name: 'Locked Settings',
      value: clamp(args.settingsLines.join('\n'), MAX_FIELD),
    });
  }

  return e;
}
