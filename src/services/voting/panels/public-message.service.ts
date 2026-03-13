import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type MessageCreateOptions,
  type MessageEditOptions,
} from 'discord.js';

import { buildGameVoteEmbed, type GameVoteQuestionField } from '../../../ui/embeds/voting.js';
import type { GameVoteProgress, GameVoteSession } from '../../../types/voting.types.js';
import { formatCiv6Leader } from '../../../data/civ6.data.js';
import { formatCiv7Civ, formatCiv7Leader } from '../../../data/civ7.data.js';
import { voteCountByOption } from '../domain/tally.service.js';
import { getSubmittedBanSummary, majorityBans } from '../domain/bans.service.js';
import { buildProgress } from '../domain/progress.service.js';

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

function formatLeaderBan(v: GameVoteSession, key: string): string {
  return v.edition === 'CIV6' ? formatCiv6Leader(key) : formatCiv7Leader(key);
}

function formatCivBan(key: string): string {
  return formatCiv7Civ(key);
}

function buildVerticalBanSection(label: string, items: readonly string[], maxLength: number): string {
  const header = `• ${label} (${items.length})`;
  const lines = [header];
  let used = header.length;

  if (items.length === 0) {
    return `${header}\n• None`;
  }

  for (let i = 0; i < items.length; i += 1) {
    const line = items[i];
    const remaining = items.length - i;
    const overflowLine = `(+${remaining} more)`;

    if (used + 1 + line.length > maxLength) {
      if (lines.length === 1) {
        return `${header}\n${overflowLine}`;
      }
      if (used + 1 + overflowLine.length <= maxLength) {
        lines.push(overflowLine);
      }
      return lines.join('\n');
    }

    lines.push(line);
    used += 1 + line.length;
  }

  return lines.join('\n');
}

function buildBansQuestionValue(v: GameVoteSession): string {
  const summary = getSubmittedBanSummary(v);
  const leaderEntries = [...summary.leader.entries()];
  const civEntries = [...summary.civ.entries()];

  if (leaderEntries.length === 0 && civEntries.length === 0) {
    return v.status === 'completed' ? '• None' : '• Pending';
  }

  const sections: string[] = [];
  let remaining = 1000;

  const finalLeaderKeys = v.status === 'completed'
    ? majorityBans(v.voterIds, new Map(v.voterIds.map((id) => [id, new Set(v.bansSubmitted.has(id) ? (v.bansByVoter.get(id) ?? { leaderKeys: [], civKeys: [] }).leaderKeys : [])])))
    : leaderEntries.map(([key]) => key);
  const finalCivKeys = v.status === 'completed' && v.edition === 'CIV7'
    ? majorityBans(v.voterIds, new Map(v.voterIds.map((id) => [id, new Set(v.bansSubmitted.has(id) ? (v.bansByVoter.get(id) ?? { leaderKeys: [], civKeys: [] }).civKeys : [])])))
    : civEntries.map(([key]) => key);

  const leaderItems = finalLeaderKeys.map((key) => `${formatLeaderBan(v, key)} ×${summary.leader.get(key) ?? 0}`);
  if (leaderItems.length > 0) {
    sections.push(buildVerticalBanSection('Leader bans', leaderItems, remaining));
    remaining = Math.max(128, 1000 - sections.join('\n\n').length);
  }

  if (v.edition === 'CIV7') {
    const civItems = finalCivKeys.map((key) => `${formatCivBan(key)} ×${summary.civ.get(key) ?? 0}`);
    if (civItems.length > 0) {
      sections.push(buildVerticalBanSection('Civ bans', civItems, remaining));
    }
  }

  return sections.join('\n\n') || '• None';
}

function buildQuestionFields(v: GameVoteSession): readonly GameVoteQuestionField[] {
  if (v.status === 'closed') return [];

  const showWinners = v.status === 'completed';
  const bansIndex = v.questions.length + 1;
  const bansTitle = showWinners ? `${bansIndex}. Bans` : `${bansIndex}. Ban Votes`;
  const bansBlock = [`**${bansTitle}**`, buildBansQuestionValue(v)].join('\n');

  if (!showWinners) {
    const blocks = v.questions.map((q, idx) => {
      const header = `**${idx + 1}. ${q.title}**`;
      const counts = voteCountByOption(q, v.votesByQuestion.get(q.id) ?? new Map<string, string>());
      const lines = q.options.map((o) => {
        const count = counts.get(o.id) ?? 0;
        return `• ${o.emoji ? `${o.emoji} ` : ''}${o.label}${count > 0 ? ` ×${count}` : ''}`;
      });
      return [header, ...lines].join('\n');
    });
    blocks.push(bansBlock);

    const left = blocks.slice(0, 5).join('\n\n');
    const right = blocks.slice(5).join('\n\n');

    if (left.length <= 1024 && right.length <= 1024) {
      return [
        { name: 'Questions (1–5)', value: left || '—', inline: true },
        { name: 'Questions (6–10)', value: right || '—', inline: true },
      ];
    }

    return [
      ...v.questions.map((q, idx) => {
        const name = `${idx + 1}. ${q.title}`;
        const counts = voteCountByOption(q, v.votesByQuestion.get(q.id) ?? new Map<string, string>());
        const lines = q.options.map((o) => `• ${o.emoji ? `${o.emoji} ` : ''}${o.label}${(counts.get(o.id) ?? 0) > 0 ? ` ×${counts.get(o.id) ?? 0}` : ''}`);
        return { name, value: lines.join('\n') || '—' };
      }),
      { name: bansTitle, value: buildBansQuestionValue(v) },
    ];
  }

  return [
    ...v.questions.map((q, idx) => {
      const name = `${idx + 1}. ${q.title}`;
      const winnerId = v.lockedSettings.get(q.id) ?? q.defaultOptionId;
      const winner = q.options.find((o) => o.id === winnerId);
      const label = winner ? `${winner.emoji ? `${winner.emoji} ` : ''}${winner.label}` : winnerId;
      const count = (v.votesByQuestion.get(q.id) && voteCountByOption(q, v.votesByQuestion.get(q.id)!).get(winnerId)) ?? 0;
      const tb = v.tiebrokenQuestions.has(q.id) ? ' *(tiebreak)*' : '';
      return { name, value: `**${label}**${count > 0 ? ` ×${count}` : ''}${tb}` };
    }),
    { name: bansTitle, value: buildBansQuestionValue(v) },
  ];
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

export function buildRenderPayload(v: GameVoteSession): PublicVotePayload {
  return buildPublicVotePayload({
    session: v,
    progress: buildProgress(v),
    questionFields: buildQuestionFields(v),
  });
}
