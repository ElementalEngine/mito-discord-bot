import { EmbedBuilder, type MessageCreateOptions, type MessageEditOptions } from 'discord.js';

import type { CivEdition } from '../../../config/types.js';
import { buildBansPanelComponents, type BanMenuOption } from '../../../ui/components/bans-panel.js';

export type BansPanelPayload = Omit<MessageCreateOptions, 'flags'> & Omit<MessageEditOptions, 'flags'>;

export function buildBansPanelPayload(args: Readonly<{
  edition: CivEdition;
  sessionId: string;
  finished: boolean;
  submitted: boolean;
  leaderSummary: string;
  civSummary?: string;
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
}>): BansPanelPayload {
  const desc: string[] = [
    'Choose one or more bans with the menus below, then press **Submit Bans**. You can keep editing until either pressing **Finish Vote** or the vote concludes and a draft is called.',
    `**Leader bans:** ${args.leaderSummary}`,
    args.edition === 'CIV7' ? `**Civ bans:** ${args.civSummary ?? '—'}` : undefined,
    args.submitted ? '✅ **Bans saved** — you can reopen this panel and keep editing until **Finish Vote**.' : undefined,
  ].filter((line): line is string => Boolean(line));

  const embed = new EmbedBuilder().setTitle('🛑 Bans').setDescription(desc.join('\n'));

  return {
    embeds: [embed],
    components: [...buildBansPanelComponents({
      sessionId: args.sessionId,
      finished: args.finished,
      leaderOptions: args.leaderOptions,
      leaderPage: args.leaderPage,
      leaderPages: args.leaderPages,
      leaderMenuDisabled: args.leaderMenuDisabled,
      leaderMenuMaxValues: args.leaderMenuMaxValues,
      civOptions: args.civOptions,
      civPage: args.civPage,
      civPages: args.civPages,
      civMenuDisabled: args.civMenuDisabled,
      civMenuMaxValues: args.civMenuMaxValues,
      submitDisabled: args.submitDisabled,
    })],
    allowedMentions: { parse: [] as const },
  };
}
