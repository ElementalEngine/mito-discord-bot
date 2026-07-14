import type { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';

import { EMOJI_ERROR } from '../../core/config/constants.js';
import {
  DraftError,
  generateDirectCiv6DraftCore,
  generateDirectCiv7DraftCore,
} from '../../engine/index.js';
import {
  buildCiv6DirectDraftSummaryEmbed,
  buildCiv7DirectDraftSummaryEmbed,
} from './ui/standard-draft.embed.js';
import {
  buildCiv6DirectDraftMessages,
  buildCiv7DirectDraftMessages,
} from './ui/standard-draft.layout.js';
import { systemRandom } from './random.js';
import type { DraftCommandRequest } from './types.js';

type Rendered = Readonly<{ embed: EmbedBuilder; messages: readonly string[] }>;

function render(request: DraftCommandRequest): Rendered {
  if (request.edition === 'CIV6') {
    const draft = generateDirectCiv6DraftCore(
      {
        gameType: request.gameType,
        numberPlayers: request.numberPlayers,
        numberTeams: request.numberTeams,
        leaderBansRaw: request.leaderBansRaw,
      },
      systemRandom
    );
    return {
      embed: buildCiv6DirectDraftSummaryEmbed(draft),
      messages: buildCiv6DirectDraftMessages(draft),
    };
  }

  const draft = generateDirectCiv7DraftCore(
    {
      gameType: request.gameType,
      startingAge: request.startingAge,
      numberPlayers: request.numberPlayers,
      numberTeams: request.numberTeams,
      leaderBansRaw: request.leaderBansRaw,
      civBansRaw: request.civBansRaw,
    },
    systemRandom
  );
  return {
    embed: buildCiv7DirectDraftSummaryEmbed(draft),
    messages: buildCiv7DirectDraftMessages(draft),
  };
}

export async function executeStandardDraft(
  interaction: ChatInputCommandInteraction,
  request: DraftCommandRequest
): Promise<void> {
  try {
    const { embed, messages } = render(request);

    await interaction.editReply({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });

    for (const content of messages) {
      await interaction.followUp({ content, allowedMentions: { parse: [] } });
    }
  } catch (err: unknown) {
    if (err instanceof DraftError) {
      await interaction.editReply({
        content: `${EMOJI_ERROR} ${err.message}`,
        embeds: [],
      });
      return;
    }
    throw err;
  }
}
