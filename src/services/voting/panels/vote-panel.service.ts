import { EmbedBuilder, type MessageCreateOptions, type MessageEditOptions } from 'discord.js';

import type { VoteQuestion } from '../../../config/types.js';
import type { GameVoteSession, StagedVoteRecord } from '../../../types/voting.types.js';
import { buildVotePanelComponents } from '../../../ui/components/vote-panel.js';
import { decodeVoteSelections, getQuestionMaxSelections } from '../domain/tally.service.js';
import {
  answeredCountInRecord,
  ensureStagedVoteRecord,
  getCommittedVoteRecordForVoter,
  voteRecordEquals,
} from '../runtime/vote-state.service.js';

type PanelPayload = Omit<MessageCreateOptions, 'flags'> & Omit<MessageEditOptions, 'flags'>;

function pickLabelsForQuestion(question: VoteQuestion, stored?: string): string {
  const selections = decodeVoteSelections(question, stored);
  if (selections.length === 0) return '—';

  return selections
    .map((selectedId) => {
      const option = question.options.find((candidate) => candidate.id === selectedId);
      return option ? `${option.emoji ? `${option.emoji} ` : ''}${option.label}` : selectedId;
    })
    .join(', ');
}

export function buildVotePanelPayload(args: Readonly<{
  session: GameVoteSession;
  voterId: string;
  activeQuestionId: string;
  stagedRecord: ReadonlyMap<string, string>;
  lines: readonly string[];
  submitted: boolean;
  question: VoteQuestion;
  currentSelections: readonly string[];
  finished: boolean;
  canSubmit: boolean;
  activeIndex: number;
  total: number;
  maxSelections: number;
}>): PanelPayload {
  const v = args.session;
  const ends = Math.floor(v.endsAtMs / 1000);
  const header =
    v.status !== 'in_progress'
      ? '**Voting has ended.**'
      : `**Ends:** <t:${ends}:t>\nAnswer all questions, then press **Submit Vote**. You can keep editing until either pressing **Finish Vote** or the vote concludes and a draft is called.`;

  const footer = args.submitted
    ? '\n\n✅ **Vote saved** — you can reopen this panel and keep editing until **Finish Vote**.'
    : '';

  const embed = new EmbedBuilder()
    .setTitle('🗳️ Vote Panel')
    .setDescription([header, '', args.lines.join('\n') || '—'].join('\n') + footer);

  return {
    embeds: [embed],
    components: [...buildVotePanelComponents({
      sessionId: v.sessionId,
      question: args.question,
      currentSelections: args.currentSelections,
      finished: args.finished,
      activeIndex: args.activeIndex,
      total: args.total,
      canSubmit: args.canSubmit,
      maxSelections: args.maxSelections,
    })],
    allowedMentions: { parse: [] as const },
  };
}

export function buildBallotPayload(args: Readonly<{
  session: GameVoteSession;
  voterId: string;
  activeQuestionId: string;
  stagedRecord?: StagedVoteRecord;
}>): PanelPayload {
  const v = args.session;
  const stagedRecord = args.stagedRecord ?? ensureStagedVoteRecord(v, args.voterId);
  const committedRecord = getCommittedVoteRecordForVoter(v, args.voterId);
  const hasDirtyChanges = !voteRecordEquals(stagedRecord, committedRecord);
  const submitted = v.voteSubmitted.has(args.voterId) && !hasDirtyChanges;
  const lines = v.questions.map((q, idx) => {
    const pickLabel = pickLabelsForQuestion(q, stagedRecord.get(q.id));
    const mark = stagedRecord.has(q.id) ? '✅' : '⬜';
    const cursor = q.id === args.activeQuestionId ? '➡️ ' : '';
    return `${cursor}${mark} ${idx + 1}. ${q.title} — ${pickLabel}`;
  });

  const total = v.questions.length;
  const answered = answeredCountInRecord(v, stagedRecord);
  const canSubmit = !v.finished.has(args.voterId) && answered >= total && !voteRecordEquals(stagedRecord, committedRecord);
  const activeIndex = Math.max(0, v.questions.findIndex((q) => q.id === args.activeQuestionId));
  const question = v.questions[activeIndex] ?? v.questions[0];
  const currentSelections = decodeVoteSelections(question, stagedRecord.get(question.id));
  const maxSelections = getQuestionMaxSelections(question);

  return buildVotePanelPayload({
    session: v,
    voterId: args.voterId,
    activeQuestionId: args.activeQuestionId,
    stagedRecord,
    lines,
    submitted,
    question,
    currentSelections,
    finished: v.finished.has(args.voterId),
    canSubmit,
    activeIndex,
    total,
    maxSelections,
  });
}
