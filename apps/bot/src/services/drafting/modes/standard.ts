import type {
  Civ6DraftResult,
  Civ7DraftResult,
  DraftCommandRequest,
} from '../../../types/drafting.types.js';
import type { DraftModeOutput } from '../../../types/drafting.types.js';
import {
  buildCiv6DirectDraftSummaryEmbed,
  buildCiv7DirectDraftSummaryEmbed,
} from '../../../ui/embeds/standard-draft.js';
import {
  buildCiv6DirectDraftMessages,
  buildCiv7DirectDraftMessages,
} from '../../../ui/layouts/standard-draft.js';
import { buildCommandStandardDraftResult } from '../draft.service.js';

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

export function runStandardDraftMode(request: DraftCommandRequest): DraftModeOutput {
  return buildCommandOutput(buildCommandStandardDraftResult(request));
}
