import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from 'discord.js';

import { CIV6_LEADERS, lookupCiv6LeaderMeta } from '../../data/civ6.data.js';
import { CIV7_CIVS, CIV7_LEADERS, lookupCiv7CivMeta, lookupCiv7LeaderMeta } from '../../data/civ7.data.js';
import type { CivEdition } from '../../config/types.js';
import type { SnakeDraftPageState, SnakeRoundKind } from '../../types/drafting.types.js';
import { humanizeGameId } from '../../utils/humanize-game-id.js';

const SNAKE_MENU_PAGE_SIZE = 25;

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

export function buildSnakeDraftPickComponents(args: Readonly<{
  edition: CivEdition;
  round: Exclude<SnakeRoundKind, 'complete'>;
  sessionId: string;
  turnToken: number;
  state: SnakeDraftPageState;
  leaders?: readonly string[];
  civs?: readonly string[];
}>): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

  if (args.round === 'leader') {
    const keys = args.leaders ?? [];
    const totalPages = Math.max(1, Math.ceil(keys.length / SNAKE_MENU_PAGE_SIZE));
    const pageKeys = keys.slice(args.state.leaderPage * SNAKE_MENU_PAGE_SIZE, (args.state.leaderPage + 1) * SNAKE_MENU_PAGE_SIZE);
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`sd:pick:leader:${args.sessionId}:${args.turnToken}`)
      .setPlaceholder(totalPages > 1 ? `Pick your leader (Page ${args.state.leaderPage + 1}/${totalPages})` : 'Pick your leader')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(pageKeys.map((key) => {
        const meta = args.edition === 'CIV6'
          ? CIV6_LEADERS[key as keyof typeof CIV6_LEADERS]
          : CIV7_LEADERS[key as keyof typeof CIV7_LEADERS];
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
          .setCustomId(`sd:nav:leader:prev:${args.sessionId}:${args.turnToken}`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel('◀ Back')
          .setDisabled(args.state.leaderPage <= 0),
        new ButtonBuilder()
          .setCustomId(`sd:nav:leader:next:${args.sessionId}:${args.turnToken}`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel('Next ▶')
          .setDisabled(args.state.leaderPage >= totalPages - 1),
      ));
    }

    return rows;
  }

  const civKeys = args.civs ?? [];
  const totalPages = Math.max(1, Math.ceil(civKeys.length / SNAKE_MENU_PAGE_SIZE));
  const pageKeys = civKeys.slice(args.state.civPage * SNAKE_MENU_PAGE_SIZE, (args.state.civPage + 1) * SNAKE_MENU_PAGE_SIZE);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`sd:pick:civ:${args.sessionId}:${args.turnToken}`)
    .setPlaceholder(totalPages > 1 ? `Pick your civ (Page ${args.state.civPage + 1}/${totalPages})` : 'Pick your civ')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(pageKeys.map((key) => {
      const meta = CIV7_CIVS[key as keyof typeof CIV7_CIVS];
      return {
        label: civLabel(key),
        value: key,
        emoji: toSelectEmoji(meta?.emojiId),
      };
    }));
  rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));

  if (totalPages > 1) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`sd:nav:civ:prev:${args.sessionId}:${args.turnToken}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('◀ Back')
        .setDisabled(args.state.civPage <= 0),
      new ButtonBuilder()
        .setCustomId(`sd:nav:civ:next:${args.sessionId}:${args.turnToken}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Next ▶')
        .setDisabled(args.state.civPage >= totalPages - 1),
    ));
  }

  return rows;
}
