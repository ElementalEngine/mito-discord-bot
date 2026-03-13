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
  civOptions?: readonly BanMenuOption[];
  civPage: number;
  civPages: number;
  civMenuDisabled: boolean;
  civMenuMaxValues: number;
  submitDisabled: boolean;
}>): readonly ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const leaderMenu = new StringSelectMenuBuilder()
    .setCustomId(`gv:banpick:leader:${args.sessionId}`)
    .setPlaceholder(`Leader bans (page ${args.leaderPage + 1}/${args.leaderPages})`)
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
      .setPlaceholder(`Civ bans (optional) (page ${args.civPage + 1}/${args.civPages})`)
      .setMinValues(0)
      .setMaxValues(Math.max(1, args.civMenuMaxValues))
      .setDisabled(args.civMenuDisabled)
      .addOptions(args.civOptions as APISelectMenuOption[]);

    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(civMenu));
  }

  const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`gv:bannav:leader:prev:${args.sessionId}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel('◀ Leaders')
      .setDisabled(args.finished || args.leaderPages <= 1),
    new ButtonBuilder()
      .setCustomId(`gv:bannav:leader:next:${args.sessionId}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Leaders ▶')
      .setDisabled(args.finished || args.leaderPages <= 1),
  );

  if (args.civOptions) {
    navRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`gv:bannav:civ:prev:${args.sessionId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('◀ Civs')
        .setDisabled(args.finished || args.civPages <= 1),
      new ButtonBuilder()
        .setCustomId(`gv:bannav:civ:next:${args.sessionId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Civs ▶')
        .setDisabled(args.finished || args.civPages <= 1),
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
