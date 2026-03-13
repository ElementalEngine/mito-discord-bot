import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type MessageCreateOptions,
  type MessageEditOptions,
} from 'discord.js';

import { buildGameVoteEmbed, type GameVoteQuestionField } from '../../../ui/embeds/voting.js';
import type { GameVoteProgress, GameVoteSession } from '../../../types/voting.types.js';

export type PublicVotePayload = Omit<MessageCreateOptions, 'flags'> & Omit<MessageEditOptions, 'flags'>;

function buildVotingButtons(v: GameVoteSession): readonly ActionRowBuilder<ButtonBuilder>[] {
  const voteBtn = new ButtonBuilder()
    .setCustomId(`gv:ballot:${v.sessionId}`)
    .setStyle(ButtonStyle.Primary)
    .setLabel('🗳️ Vote Panel');

  const bansBtn = new ButtonBuilder()
    .setCustomId(`gv:ban:${v.sessionId}`)
    .setStyle(ButtonStyle.Primary)
    .setLabel('🔨 Ban Panel');

  const finishBtn = new ButtonBuilder()
    .setCustomId(`gv:finishvote:${v.sessionId}`)
    .setStyle(ButtonStyle.Success)
    .setLabel('➕ Finish Vote');

  const randomizeBtn = new ButtonBuilder()
    .setCustomId(`gv:randomvote:${v.sessionId}`)
    .setStyle(ButtonStyle.Danger)
    .setLabel('🎲 Randomize My Vote');

  return [new ActionRowBuilder<ButtonBuilder>().addComponents(voteBtn, bansBtn, finishBtn, randomizeBtn)];
}

export function buildPublicVotePayload(args: Readonly<{
  session: GameVoteSession;
  progress: GameVoteProgress;
  questionFields: readonly GameVoteQuestionField[];
}>): PublicVotePayload {
  const v = args.session;
  const embed = buildGameVoteEmbed({
    edition: v.edition,
    gameType: v.gameType,
    startingAge: v.startingAge,
    status: v.status,
    phase: v.phase,
    startedAtMs: v.startedAtMs,
    endsAtMs: v.endsAtMs,
    completedAtMs: v.completedAtMs,
    progress: args.progress,
    questionFields: args.questionFields,
    voteUuid: v.sessionId,
  });

  const components = v.status === 'in_progress' && v.phase === 'voting'
    ? buildVotingButtons(v)
    : [];

  return {
    embeds: [embed],
    components: [...components],
    allowedMentions: { parse: [] as const },
  };
}
