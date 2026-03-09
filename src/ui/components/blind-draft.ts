import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from 'discord.js';

import { CIV6_LEADERS } from '../../data/civ6.data.js';
import { CIV7_CIVS, CIV7_LEADERS } from '../../data/civ7.data.js';
import type { CivEdition } from '../../config/types.js';
import type { BlindDraftPageState, BlindDraftPools } from '../../types/voting.types.js';

const BLIND_MENU_PAGE_SIZE = 25;

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
          return { label: meta.gameId, value: key };
        })
      );

    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(civMenu));

    if (totalPages > 1) {
      navButtons.push(
        new ButtonBuilder()
          .setCustomId(`gv:nav:civ:prev:${args.sessionId}`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel('◀ Back')
          .setDisabled(args.state.civPage <= 0),
        new ButtonBuilder()
          .setCustomId(`gv:nav:civ:next:${args.sessionId}`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel('Next ▶')
          .setDisabled(args.state.civPage >= totalPages - 1)
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
        return { label: meta.gameId, value: key };
      })
    );
  rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(leaderMenu));

  if (leaderTotalPages > 1) {
    navButtons.push(
      new ButtonBuilder()
        .setCustomId(`gv:nav:leader:prev:${args.sessionId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('◀ Back')
        .setDisabled(args.state.leaderPage <= 0),
      new ButtonBuilder()
        .setCustomId(`gv:nav:leader:next:${args.sessionId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Next ▶')
        .setDisabled(args.state.leaderPage >= leaderTotalPages - 1)
    );
  }

  if (navButtons.length > 0) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(navButtons));
  }

  return rows;
}
