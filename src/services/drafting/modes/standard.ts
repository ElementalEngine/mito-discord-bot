import type {
  Civ6DraftResult,
  Civ7DraftResult,
  DraftCommandRequest,
  VoteDraftRequest,
} from '../../../types/drafting.types.js';
import type { DraftModeOutput } from '../../../types/drafting.types.js';
import {
  buildCiv6DirectDraftSummaryEmbed,
  buildCiv6DraftEmbed,
  buildCiv7DirectDraftSummaryEmbed,
  buildCiv7DraftEmbed,
} from '../../../ui/embeds/standard-draft.js';
import {
  buildCiv6DirectDraftMessages,
  buildCiv7DirectDraftMessages,
} from '../../../ui/layouts/standard-draft.js';
import {
  buildCommandStandardDraftResult,
  buildVoteStandardDraftResult,
} from '../draft.service.js';
import { labelForVoteGroup } from '../domain/labels.service.js';

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

  const groupLabels = request.gameType === 'Teamer'
    ? undefined
    : request.voterIds.map((voterId, index) => request.voterUsersById?.has(voterId)
      ? `<@${voterId}>`
      : labelForVoteGroup('Player', index));

  if (request.edition === 'CIV6') {
    const draft = buildVoteStandardDraftResult(request) as Civ6DraftResult;
    return { embeds: [buildCiv6DraftEmbed(draft, groupLabels)] };
  }

  const draft = buildVoteStandardDraftResult(request) as Civ7DraftResult;
  return { embeds: [buildCiv7DraftEmbed(draft, groupLabels)] };
}
