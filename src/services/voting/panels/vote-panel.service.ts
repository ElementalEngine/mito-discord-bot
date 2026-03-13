import { EmbedBuilder, type MessageCreateOptions, type MessageEditOptions } from 'discord.js';

import type { VoteQuestion } from '../../../config/types.js';
import type { GameVoteSession } from '../../../types/voting.types.js';
import { buildVotePanelComponents } from '../../../ui/components/vote-panel.js';

type PanelPayload = Omit<MessageCreateOptions, 'flags'> & Omit<MessageEditOptions, 'flags'>;

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
