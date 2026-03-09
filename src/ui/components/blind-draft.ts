import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from 'discord.js';

import { CIV6_LEADERS, lookupCiv6LeaderMeta } from '../../data/civ6.data.js';
import { CIV7_CIVS, CIV7_LEADERS, lookupCiv7CivMeta, lookupCiv7LeaderMeta } from '../../data/civ7.data.js';
import type { CivEdition } from '../../config/types.js';
import type { BlindDraftPageState, BlindDraftPick, BlindDraftPools } from '../../types/drafting.types.js';
import { humanizeGameId } from '../../utils/humanize-game-id.js';

const BLIND_MENU_PAGE_SIZE = 25;


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

export function clampBlindDraftPageState(args: Readonly<{
  edition: CivEdition;
  pools: BlindDraftPools;
  state: BlindDraftPageState;
}>): BlindDraftPageState {
  const civTotalPages = args.edition === 'CIV7' && args.pools.civs
    ? Math.max(1, Math.ceil(args.pools.civs.length / BLIND_MENU_PAGE_SIZE))
    : 1;
  const leaderTotalPages = Math.max(1, Math.ceil(args.pools.leaders.length / BLIND_MENU_PAGE_SIZE));

  return {
    civPage: Math.max(0, Math.min(args.state.civPage, civTotalPages - 1)),
    leaderPage: Math.max(0, Math.min(args.state.leaderPage, leaderTotalPages - 1)),
  };
}

export function buildBlindDraftPickComponents(args: Readonly<{
  edition: CivEdition;
  sessionId: string;
  pools: BlindDraftPools;
  state: BlindDraftPageState;
  pick?: BlindDraftPick;
}>): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
  const navButtons: ButtonBuilder[] = [];

  if (args.edition === 'CIV7' && args.pools.civs) {
    const totalPages = Math.max(1, Math.ceil(args.pools.civs.length / BLIND_MENU_PAGE_SIZE));
    const pageKeys = args.pools.civs.slice(
      args.state.civPage * BLIND_MENU_PAGE_SIZE,
      (args.state.civPage + 1) * BLIND_MENU_PAGE_SIZE
    );

    const civMenu = new StringSelectMenuBuilder()
      .setCustomId(`gv:pick:civ:${args.sessionId}`)
      .setPlaceholder(
        totalPages > 1
          ? `Pick your civ (Page ${args.state.civPage + 1}/${totalPages})`
          : 'Pick your civ'
      )
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        pageKeys.map((key: string) => {
          const meta = CIV7_CIVS[key as keyof typeof CIV7_CIVS];
          return {
            label: civLabel(key),
            value: key,
            emoji: toSelectEmoji(meta?.emojiId),
            default: args.pick?.civKey === key,
          };
        })
      )
      .setDisabled(Boolean(args.pick?.civKey));

    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(civMenu));

    if (totalPages > 1) {
      navButtons.push(
        new ButtonBuilder()
          .setCustomId(`gv:nav:civ:prev:${args.sessionId}`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel('◀ Back')
          .setDisabled(Boolean(args.pick?.civKey) || args.state.civPage <= 0),
        new ButtonBuilder()
          .setCustomId(`gv:nav:civ:next:${args.sessionId}`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel('Next ▶')
          .setDisabled(Boolean(args.pick?.civKey) || args.state.civPage >= totalPages - 1)
      );
    }
  }

  const leaderTotalPages = Math.max(1, Math.ceil(args.pools.leaders.length / BLIND_MENU_PAGE_SIZE));
  const leaderPageKeys = args.pools.leaders.slice(
    args.state.leaderPage * BLIND_MENU_PAGE_SIZE,
    (args.state.leaderPage + 1) * BLIND_MENU_PAGE_SIZE
  );

  const leaderMenu = new StringSelectMenuBuilder()
    .setCustomId(`gv:pick:leader:${args.sessionId}`)
    .setPlaceholder(
      leaderTotalPages > 1
        ? `Pick your leader (Page ${args.state.leaderPage + 1}/${leaderTotalPages})`
        : 'Pick your leader'
    )
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      leaderPageKeys.map((key: string) => {
        const meta = args.edition === 'CIV6'
          ? CIV6_LEADERS[key as keyof typeof CIV6_LEADERS]
          : CIV7_LEADERS[key as keyof typeof CIV7_LEADERS];
        return {
          label: leaderLabel(args.edition, key),
          value: key,
          emoji: toSelectEmoji(meta?.emojiId),
          default: args.pick?.leaderKey === key,
        };
      })
    )
    .setDisabled(Boolean(args.pick?.leaderKey));
  rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(leaderMenu));

  if (leaderTotalPages > 1) {
    navButtons.push(
      new ButtonBuilder()
        .setCustomId(`gv:nav:leader:prev:${args.sessionId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('◀ Back')
.setDisabled(Boolean(args.pick?.leaderKey) || args.state.leaderPage <= 0),
      new ButtonBuilder()
        .setCustomId(`gv:nav:leader:next:${args.sessionId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Next ▶')
.setDisabled(Boolean(args.pick?.leaderKey) || args.state.leaderPage >= leaderTotalPages - 1)
    );
  }

  if (navButtons.length > 0) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(navButtons));
  }

  return rows;
}
