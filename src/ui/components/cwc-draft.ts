import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from 'discord.js';

import type { CivEdition } from '../../config/types.js';
import { lookupCiv6LeaderMeta } from '../../data/civ6.data.js';
import { CIV7_CIVS, lookupCiv7CivMeta, lookupCiv7LeaderMeta } from '../../data/civ7.data.js';
import type { CwcDraftPageState } from '../../types/drafting.types.js';
import { humanizeGameId } from '../../utils/humanize-game-id.js';

const CWC_MENU_PAGE_SIZE = 25;

function toSelectEmoji(emojiId?: string): { id: string } | undefined {
  return emojiId && /^\d{15,22}$/.test(emojiId) ? { id: emojiId } : undefined;
}

function leaderLabel(edition: CivEdition, key: string): string {
  const gameId = edition === 'CIV6'
    ? lookupCiv6LeaderMeta(key)?.gameId
    : lookupCiv7LeaderMeta(key)?.gameId;
  return humanizeGameId(gameId ?? key);
}

function civLabel(key: string): string {
  return humanizeGameId(lookupCiv7CivMeta(key)?.gameId ?? key);
}

export function buildCwcCaptainSelectComponents(args: Readonly<{
  sessionId: string;
  teamCaptains: readonly [string | null, string | null];
  voterIds: readonly string[];
  labelsById: ReadonlyMap<string, string>;
}>): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const options = args.voterIds.map((id) => ({
    label: args.labelsById.get(id) ?? id,
    value: id,
    default: args.teamCaptains[0] === id || args.teamCaptains[1] === id,
  }));

  const team1 = new StringSelectMenuBuilder()
    .setCustomId(`cw:captain:0:${args.sessionId}`)
    .setPlaceholder('Select Team 1 captain')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options.map((option) => ({
      ...option,
      default: args.teamCaptains[0] === option.value,
    })));

  const team2 = new StringSelectMenuBuilder()
    .setCustomId(`cw:captain:1:${args.sessionId}`)
    .setPlaceholder('Select Team 2 captain')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options.map((option) => ({
      ...option,
      default: args.teamCaptains[1] === option.value,
    })));

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(team1),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(team2),
  ];
}

export function buildCwcPickComponents(args: Readonly<{
  edition: CivEdition;
  round: 'leader' | 'civ';
  sessionId: string;
  turnToken: number;
  state: CwcDraftPageState;
  leaders?: readonly string[];
  civs?: readonly string[];
}>): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

  if (args.round === 'leader') {
    const keys = args.leaders ?? [];
    const totalPages = Math.max(1, Math.ceil(keys.length / CWC_MENU_PAGE_SIZE));
    const pageKeys = keys.slice(args.state.leaderPage * CWC_MENU_PAGE_SIZE, (args.state.leaderPage + 1) * CWC_MENU_PAGE_SIZE);
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`cw:pick:leader:${args.sessionId}:${args.turnToken}`)
      .setPlaceholder(totalPages > 1 ? `Pick leader (Page ${args.state.leaderPage + 1}/${totalPages})` : 'Pick leader')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(pageKeys.map((key) => {
        const meta = args.edition === 'CIV6'
          ? lookupCiv6LeaderMeta(key)
          : lookupCiv7LeaderMeta(key);
        return {
          label: leaderLabel(args.edition, key),
          value: key,
          emoji: toSelectEmoji(meta?.emojiId),
        };
      }));

    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));

    if (totalPages > 1) {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`cw:nav:leader:prev:${args.sessionId}:${args.turnToken}`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel('◀ Back')
          .setDisabled(args.state.leaderPage <= 0),
        new ButtonBuilder()
          .setCustomId(`cw:nav:leader:next:${args.sessionId}:${args.turnToken}`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel('Next ▶')
          .setDisabled(args.state.leaderPage >= totalPages - 1),
      ));
    }

    return rows;
  }

  const civKeys = args.civs ?? [];
  const totalPages = Math.max(1, Math.ceil(civKeys.length / CWC_MENU_PAGE_SIZE));
  const pageKeys = civKeys.slice(args.state.civPage * CWC_MENU_PAGE_SIZE, (args.state.civPage + 1) * CWC_MENU_PAGE_SIZE);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`cw:pick:civ:${args.sessionId}:${args.turnToken}`)
    .setPlaceholder(totalPages > 1 ? `Pick civ (Page ${args.state.civPage + 1}/${totalPages})` : 'Pick civ')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(pageKeys.map((key) => ({
      label: civLabel(key),
      value: key,
      emoji: toSelectEmoji(CIV7_CIVS[key as keyof typeof CIV7_CIVS]?.emojiId),
    })));
  rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));

  if (totalPages > 1) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`cw:nav:civ:prev:${args.sessionId}:${args.turnToken}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('◀ Back')
        .setDisabled(args.state.civPage <= 0),
      new ButtonBuilder()
        .setCustomId(`cw:nav:civ:next:${args.sessionId}:${args.turnToken}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Next ▶')
        .setDisabled(args.state.civPage >= totalPages - 1),
    ));
  }

  return rows;
}
