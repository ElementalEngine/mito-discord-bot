import { EMOJI_CONFIRM } from '../../config/constants.js';
import { CIV6_LEADERS } from '../../data/civ6.data.js';
import { CIV7_CIVS, CIV7_LEADERS } from '../../data/civ7.data.js';
import type { CivEdition } from '../../config/types.js';
import type { VoteDraftRequest } from '../../types/draft.js';
import type { BlindDraftLaunch, DraftModeOutput } from '../../types/drafting.types.js';
import type { BlindDraftPick } from '../../types/voting.types.js';
import type { DraftModeDeps } from '../draftmode.service.js';
import { DraftError } from '../draft.service.js';
import { buildStandardDraftResult } from './standard.js';

function createBlindDraftLaunch(request: VoteDraftRequest): BlindDraftLaunch {
  try {
    const draft = buildStandardDraftResult({
      ...request,
      draftMode: 'standard',
    });

    return {
      ok: true,
      assignments: request.voterIds.map((voterId, index) => {
        const group = draft.groups[index];
        return request.edition === 'CIV6'
          ? { voterId, leaders: group.leaders }
          : { voterId, leaders: group.leaders, civs: group.civs ?? [] };
      }),
    };
  } catch (err: unknown) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Blind draft setup failed.',
    };
  }
}

export function buildBlindDraftResultOutput(args: Readonly<{
  edition: CivEdition;
  voterIds: readonly string[];
  picks: ReadonlyMap<string, BlindDraftPick>;
  reason: 'timeout' | 'complete';
}>): DraftModeOutput {
  const lines: string[] = [];
  lines.push(`${EMOJI_CONFIRM} **Blind draft results** (${args.reason === 'timeout' ? 'timeout' : 'complete'})`);
  lines.push('');

  for (const id of args.voterIds) {
    const pick = args.picks.get(id);
    if (!pick) continue;
    const mark = pick.defaulted ? ' *(defaulted)*' : '';

    if (args.edition === 'CIV6') {
      const leader = pick.leaderKey
        ? CIV6_LEADERS[pick.leaderKey as keyof typeof CIV6_LEADERS].gameId
        : '—';
      lines.push(`• <@${id}> — **${leader}**${mark}`);
      continue;
    }

    const civ = pick.civKey
      ? CIV7_CIVS[pick.civKey as keyof typeof CIV7_CIVS].gameId
      : '—';
    const leader = pick.leaderKey
      ? CIV7_LEADERS[pick.leaderKey as keyof typeof CIV7_LEADERS].gameId
      : '—';
    lines.push(`• <@${id}> — **${civ}** + **${leader}**${mark}`);
  }

  return {
    content: lines.join('\n'),
    allowedMentions: { parse: [] as const },
  };
}

export async function runBlindDraftMode(
  request: VoteDraftRequest,
  deps: DraftModeDeps
): Promise<null> {
  if (request.source !== 'vote') {
    throw new DraftError('VALIDATION', 'Blind draft is only available from the vote flow.');
  }
  if (!deps.startBlindDraft) {
    throw new DraftError('VALIDATION', 'Blind draft launcher is unavailable.');
  }

  await deps.startBlindDraft(request, createBlindDraftLaunch(request));
  return null;
}
