import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type APISelectMenuOption,
} from 'discord.js';

import type { VoteQuestion } from '../../config/types.js';

export function buildVotePanelComponents(args: Readonly<{
  sessionId: string;
  question: VoteQuestion;
  currentSelections: readonly string[];
  finished: boolean;
  activeIndex: number;
  total: number;
  canSubmit: boolean;
  maxSelections: number;
}>): readonly ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const optionSelect = new StringSelectMenuBuilder()
    .setCustomId(`gv:ballotv:${args.sessionId}`)
    .setPlaceholder(
      (args.maxSelections > 1
        ? `Select up to ${args.maxSelections} options for ${args.question.title}`
        : `Select an option for ${args.question.title}`).slice(0, 150),
    )
    .setMinValues(1)
    .setMaxValues(args.maxSelections)
    .setDisabled(args.finished)
    .addOptions(
      args.question.options.slice(0, 25).map((option): APISelectMenuOption => ({
        label: `${option.emoji ? `${option.emoji} ` : ''}${option.label}`.slice(0, 100),
        value: option.id,
        default: args.currentSelections.includes(option.id),
      })),
    );

  const prevBtn = new ButtonBuilder()
    .setCustomId(`gv:ballotnav:prev:${args.sessionId}`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('◀ Back')
    .setDisabled(args.finished || args.activeIndex <= 0);

  const nextBtn = new ButtonBuilder()
    .setCustomId(`gv:ballotnav:next:${args.sessionId}`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Next ▶')
    .setDisabled(args.finished || args.activeIndex >= args.total - 1);

  const submitBtn = new ButtonBuilder()
    .setCustomId(`gv:submitvote:${args.sessionId}`)
    .setStyle(ButtonStyle.Success)
    .setLabel('Submit Vote')
    .setDisabled(!args.canSubmit);

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(optionSelect),
    new ActionRowBuilder<ButtonBuilder>().addComponents(prevBtn, nextBtn, submitBtn),
  ];
}
