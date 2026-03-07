import { EmbedBuilder } from 'discord.js';

import type { DraftGameType } from '../../types/draft.js';
import type { CivEdition } from '../../config/types.js';
import type { Civ7StartingAge } from '../../data/types.js';
import type { GameVotePhase, GameVoteProgress } from '../../types/gamevote.js';

const MAX_FIELD_VALUE = 1024;
const MAX_FIELD_NAME = 256;

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

function fmtTimerLines(startedAtMs: number, endsAtMs: number, nowMs: number): readonly string[] {
  const started = Math.floor(startedAtMs / 1000);
  const ends = Math.floor(endsAtMs / 1000);
  const now = Math.floor(nowMs / 1000);

  const startedLine = `**Vote started:** <t:${started}:t> (<t:${started}:R>)`;

  if (ends <= now) {
    return [startedLine, '**Auto-close:** Ended'];
  }

  return [startedLine, `**Auto-close:** <t:${ends}:t> (<t:${ends}:R>)`];
}

function renderVoters(p: GameVoteProgress): string {
  const lines = p.voters.map((v) => {
    const finished = p.finishedIds.has(v.id);
    const answered = p.answeredCountById.get(v.id) ?? 0;
    const total = p.totalQuestions;

    let status = '—';
    if (p.phase === 'voting') {
      status = `${answered}/${total}${finished ? ' ✅' : ''}`;
    } else if (p.phase === 'bans') {
      status = p.bansSubmittedIds.has(v.id) ? 'Bans submitted' : 'Awaiting';
    } else if (p.phase === 'blind_draft') {
      status = p.blindDraftPickedIds.has(v.id) ? 'Picked' : 'Awaiting pick';
    } else {
      status = 'Done';
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
  nowMs: number;
  startedAtMs: number;
  endsAtMs: number;
  progress: GameVoteProgress;
  questionFields?: readonly GameVoteQuestionField[];
}>): EmbedBuilder {
  const title = `🗳️ Game Vote — ${fmtEdition(args.edition)}`;

  const meta: string[] = [
    `**Game Type:** ${args.gameType}`,
    args.edition === 'CIV7' ? `**Starting Age:** ${args.startingAge ?? '—'}` : undefined,
    `**Phase:** ${fmtPhase(args.phase)}`,
    ...fmtTimerLines(args.startedAtMs, args.endsAtMs, args.nowMs),
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
