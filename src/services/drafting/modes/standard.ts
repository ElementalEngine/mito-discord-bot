import type {
  Civ6DraftResult,
  Civ7DraftResult,
  DraftCommandRequest,
  VoteDraftRequest,
} from '../../../types/drafting.types.js';
import type { DraftModeOutput } from '../../../types/drafting.types.js';
import {
  buildCiv6DirectDraftSummaryEmbed,
  buildCiv6VoteDraftSummaryEmbed,
  buildCiv7DirectDraftSummaryEmbed,
  buildCiv7VoteDraftSummaryEmbed,
} from '../../../ui/embeds/standard-draft.js';
import {
  buildCiv6DirectDraftMessages,
  buildCiv6VoteDraftMessages,
  buildCiv7DirectDraftMessages,
  buildCiv7VoteDraftMessages,
} from '../../../ui/layouts/standard-draft.js';
import {
  buildCommandStandardDraftResult,
  buildVoteStandardDraftResult,
} from '../draft.service.js';


function draftGroupTeamLabels(draft: Civ6DraftResult | Civ7DraftResult): string[] {
  return draft.groups.map((_, index) => `Team ${index + 1}`);
}

function buildCommandOutput(draft: Civ6DraftResult | Civ7DraftResult): DraftModeOutput {
  const messages = draft.gameVersion === 'civ6'
    ? buildCiv6DirectDraftMessages(draft)
    : buildCiv7DirectDraftMessages(draft);

  const followUps = messages.map((content) => ({
    content,
    allowedMentions: { parse: [] as const },
  }));

  if (draft.gameVersion === 'civ6') {
    return {
      embeds: [buildCiv6DirectDraftSummaryEmbed(draft)],
      allowedMentions: { parse: [] as const },
      followUps,
    };
  }

  return {
    embeds: [buildCiv7DirectDraftSummaryEmbed(draft)],
    allowedMentions: { parse: [] as const },
    followUps,
  };
}

export async function runStandardDraftMode(
  request: DraftCommandRequest | VoteDraftRequest,
): Promise<DraftModeOutput> {
  if (request.source === 'command') {
    return buildCommandOutput(buildCommandStandardDraftResult(request));
  }

  const draft = buildVoteStandardDraftResult(request);
  const groupLabels = request.gameType === 'Teamer'
    ? draftGroupTeamLabels(draft)
    : request.voterIds.map((voterId) => `<@${voterId}>`);

  if (draft.gameVersion === 'civ6') {
    const followUps = buildCiv6VoteDraftMessages(draft, groupLabels).map((content) => ({ content }));
    return { embeds: [buildCiv6VoteDraftSummaryEmbed(draft)], followUps };
  }

  const followUps = buildCiv7VoteDraftMessages(draft, groupLabels).map((content) => ({ content }));
  return { embeds: [buildCiv7VoteDraftSummaryEmbed(draft)], followUps };
}
