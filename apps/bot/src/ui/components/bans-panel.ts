import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type APISelectMenuOption,
} from 'discord.js';

export type BanMenuOption = Readonly<{
  label: string;
  value: string;
  emoji?: { id: string };
  default?: boolean;
}>;

export function buildBansPanelComponents(args: Readonly<{
  sessionId: string;
  finished: boolean;
  leaderOptions: readonly BanMenuOption[];
  leaderPage: number;
  leaderPages: number;
  leaderMenuDisabled: boolean;
  leaderMenuMaxValues: number;
  leaderSearchQuery?: string;
  civOptions?: readonly BanMenuOption[];
  civPage: number;
  civPages: number;
  civMenuDisabled: boolean;
  civMenuMaxValues: number;
  civSearchQuery?: string;
  submitDisabled: boolean;
}>): readonly ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const leaderMenu = new StringSelectMenuBuilder()
    .setCustomId(`gv:banpick:leader:${args.sessionId}`)
    .setPlaceholder(args.leaderSearchQuery
      ? `Leader results: ${args.leaderSearchQuery}`
      : `Browse leader bans (page ${args.leaderPage + 1}/${args.leaderPages})`)
    .setMinValues(0)
    .setMaxValues(Math.max(1, args.leaderMenuMaxValues))
    .setDisabled(args.leaderMenuDisabled)
    .addOptions(args.leaderOptions as APISelectMenuOption[]);

  const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(leaderMenu),
  ];

  if (args.civOptions) {
    const civMenu = new StringSelectMenuBuilder()
      .setCustomId(`gv:banpick:civ:${args.sessionId}`)
      .setPlaceholder(args.civSearchQuery
        ? `Civ results: ${args.civSearchQuery}`
        : `Browse civ bans (page ${args.civPage + 1}/${args.civPages})`)
      .setMinValues(0)
      .setMaxValues(Math.max(1, args.civMenuMaxValues))
      .setDisabled(args.civMenuDisabled)
      .addOptions(args.civOptions as APISelectMenuOption[]);

    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(civMenu));
  }

  const searchRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`gv:bansearch:leader:${args.sessionId}`)
      .setStyle(ButtonStyle.Primary)
      .setLabel('Search Leaders')
      .setDisabled(args.finished),
  );

  if (args.civOptions) {
    searchRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`gv:bansearch:civ:${args.sessionId}`)
        .setStyle(ButtonStyle.Primary)
        .setLabel('Search Civs')
        .setDisabled(args.finished),
    );
  }

  rows.push(searchRow);

  const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`gv:bannav:leader:prev:${args.sessionId}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel('◀ Leaders')
      .setDisabled(args.finished || Boolean(args.leaderSearchQuery) || args.leaderPages <= 1),
    new ButtonBuilder()
      .setCustomId(`gv:bannav:leader:next:${args.sessionId}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Leaders ▶')
      .setDisabled(args.finished || Boolean(args.leaderSearchQuery) || args.leaderPages <= 1),
  );

  if (args.civOptions) {
    navRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`gv:bannav:civ:prev:${args.sessionId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('◀ Civs')
        .setDisabled(args.finished || Boolean(args.civSearchQuery) || args.civPages <= 1),
      new ButtonBuilder()
        .setCustomId(`gv:bannav:civ:next:${args.sessionId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Civs ▶')
        .setDisabled(args.finished || Boolean(args.civSearchQuery) || args.civPages <= 1),
    );
  }

  navRow.addComponents(
    new ButtonBuilder()
      .setCustomId(`gv:bansubmit:${args.sessionId}`)
      .setStyle(ButtonStyle.Success)
      .setLabel('Submit Bans')
      .setDisabled(args.submitDisabled),
  );

  rows.push(navRow);

  return rows;
}
