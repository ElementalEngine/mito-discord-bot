import {
  InteractionContextType,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type SlashCommandSubcommandBuilder,
} from 'discord.js';

import { ApiClient } from '../../api/index.js';
import { config } from '../../config.js';
import { civNames, civRows } from '../../services/civ-names.js';
import { postDraft } from '../../services/draft.service.js';
import { AGE_CHOICES, EVERY_AGE, MODE_CHOICES, banForm, type Age, type DraftChoice, type Edition, type Mode } from '../../ui/panels/draft.js';
import { defer, fail, refuse } from '../../ui/reply.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';
import { postAboutOf, withPostOptions } from '../../utils/post-options.js';

const api = new ApiClient();
const MAX_DRAFTS: Readonly<Record<Edition, number>> = { civ6: 14, civ7: 10 };

// A quick draft: the counts, whether to ban first, and what it is for.
// Settings and seats belong to a hosted game.
function subcommand(sub: SlashCommandSubcommandBuilder, edition: Edition): SlashCommandSubcommandBuilder {
  sub
    .setName(edition)
    .setDescription(edition === 'civ6' ? 'Deal Civ6 drafts.' : 'Deal Civ7 drafts of leaders and civs.')
    .addStringOption((o) =>
      o
        .setName('mode')
        .setDescription('Game mode')
        .setRequired(true)
        .addChoices(...MODE_CHOICES),
    )
    .addIntegerOption((o) =>
      o.setName('drafts').setDescription('Number of drafts: one per player, or one per team').setRequired(true).setMinValue(2).setMaxValue(MAX_DRAFTS[edition]),
    );
  if (edition === 'civ6') {
    sub.addIntegerOption((o) => o.setName('civs').setDescription('Civs per draft').setRequired(true).setMinValue(1));
  } else {
    sub
      .addIntegerOption((o) => o.setName('leaders').setDescription('Leaders per draft').setRequired(true).setMinValue(1))
      .addIntegerOption((o) => o.setName('civs').setDescription('Civs per draft').setRequired(true).setMinValue(1))
      .addStringOption((o) =>
        o
          .setName('age')
          .setDescription('Starting age')
          .setRequired(true)
          .addChoices(...AGE_CHOICES),
      );
  }
  const banned = edition === 'civ6' ? 'leaders' : 'leaders and civs';
  return withPostOptions(
    sub.addBooleanOption((o) =>
      o.setName('bans').setDescription(`True: pick ${banned} to ban in a form, then deal. False: deal now.`).setRequired(true),
    ),
  );
}

export const data = new SlashCommandBuilder()
  .setName('draft')
  .setDescription('Deal drafts for a game, with optional bans.')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) => subcommand(sub, 'civ6'))
  .addSubcommand((sub) => subcommand(sub, 'civ7'));

function policyFor(edition: Edition) {
  const c = config.discord.channels;
  return {
    allowedChannelIds: edition === 'civ6' ? [c.botTesting, c.civ6Commands, c.noviceCommands, c.cloudCommands] : [c.botTesting, c.civ7Commands],
    requiredRoleIds: [config.discord.roles.civ6Rank, config.discord.roles.civ7Rank, config.discord.roles.civCloud],
    allowDeveloperOverride: true,
  } as const;
}

function choiceOf(interaction: ChatInputCommandInteraction, edition: Edition): DraftChoice {
  const o = interaction.options;
  const age = edition === 'civ7' ? o.getString('age', true) : EVERY_AGE;
  return {
    edition,
    mode: o.getString('mode', true) as Mode,
    drafts: o.getInteger('drafts', true),
    leaders: edition === 'civ6' ? o.getInteger('civs', true) : o.getInteger('leaders', true),
    civs: edition === 'civ7' ? o.getInteger('civs', true) : null,
    age: age === EVERY_AGE ? null : (age as Age),
  };
}

// Without bans the draft is dealt at once; with them, a form comes first, and
// a form must be the command's first answer, so nothing is deferred before it.
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const edition: Edition = interaction.options.getSubcommand(true) === 'civ7' ? 'civ7' : 'civ6';
    if (!(await ensureCommandAccess(interaction, policyFor(edition)))) return;
    const choice = choiceOf(interaction, edition);
    if (choice.mode === 'duel' && choice.drafts !== 2) refuse('A duel is two drafts. Set drafts to 2.');
    const about = postAboutOf(interaction);
    if (interaction.options.getBoolean('bans', true)) {
      const [rows, names] = await Promise.all([civRows(edition, api), civNames(edition, api)]);
      await interaction.showModal(banForm(choice, about, rows, names));
      return;
    }
    await defer(interaction, 'public');
    await postDraft(interaction, choice, { leaders: [], civs: [] }, about, api);
  } catch (error) {
    await fail(interaction, error, 'deal the draft', { command: 'draft' });
  }
}
