import { randomInt } from 'node:crypto';

import { EMOJI_FAIL } from '../../config/constants.js';
import { CIV6_LEADERS } from '../../data/civ6.data.js';
import { CIV7_CIVS, CIV7_LEADERS } from '../../data/civ7.data.js';
import type { VoteDraftRequest } from '../../types/draft.js';
import { DraftError } from '../draft.service.js';
import type { DraftModeOutput } from '../../types/drafting.types.js';

function pickDistinctStable<T>(pool: readonly T[], count: number): T[] {
  if (count <= 0) return [];
  const copy = pool.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(count, copy.length));
}

export async function runCwcDraftMode(request: VoteDraftRequest): Promise<DraftModeOutput> {
  if (request.source !== 'vote') {
    throw new DraftError('VALIDATION', 'CWC is only available from the vote flow.');
  }

  if (request.gameType !== 'Teamer') {
    return {
      content: `${EMOJI_FAIL} CWC is only available for **Teamer**.`,
      allowedMentions: { parse: [] as const },
    };
  }
  if (request.numberTeams !== 2) {
    return {
      content: `${EMOJI_FAIL} CWC requires **number-teams=2**. Use Standard instead.`,
      allowedMentions: { parse: [] as const },
    };
  }
  if (request.voterIds.length !== 8) {
    return {
      content: `${EMOJI_FAIL} CWC currently supports **8 players** (4v4). Use Standard instead.`,
      allowedMentions: { parse: [] as const },
    };
  }

  const pickOrder = [0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0] as const;
  const bannedLeaders = new Set(request.bannedLeaderKeys);
  const bannedCivs = new Set(request.bannedCivKeys);

  const leaderPoolAll =
    request.edition === 'CIV6'
      ? Object.keys(CIV6_LEADERS).filter((key) => !bannedLeaders.has(key))
      : Object.keys(CIV7_LEADERS).filter((key) => !bannedLeaders.has(key));

  const leadersPickPool = pickDistinctStable(leaderPoolAll, 20);

  let civPickPool: string[] = [];
  if (request.edition === 'CIV7') {
    const allowAllAges = request.startingAge === 'None';
    const civAll = Object.entries(CIV7_CIVS)
      .filter(([key, meta]) => !bannedCivs.has(key) && (allowAllAges || meta.agePool === request.startingAge))
      .map(([key]) => key);
    civPickPool = pickDistinctStable(civAll, 14);
  }

  const lines: string[] = [];
  lines.push('**CWC draft** (shared pool)');
  if (request.edition === 'CIV7') {
    lines.push(`Starting Age: **${request.startingAge ?? '—'}**`);
  }
  lines.push('');

  const picksPerRound = 8;
  if (request.edition === 'CIV6') {
    lines.push('**Round 1 (Leaders)**');
    for (let i = 0; i < picksPerRound; i++) lines.push(`Pick ${i + 1}: Team ${pickOrder[i] + 1}`);
  } else {
    lines.push('**Round 1 (Civs)**');
    for (let i = 0; i < picksPerRound; i++) lines.push(`Pick ${i + 1}: Team ${pickOrder[i] + 1}`);
    lines.push('');
    lines.push('**Round 2 (Leaders)**');
    for (let i = 0; i < picksPerRound; i++) lines.push(`Pick ${i + 1}: Team ${pickOrder[picksPerRound + i] + 1}`);
  }

  lines.push('');
  if (request.edition === 'CIV7') {
    lines.push(`**Shared Civ Pool (${civPickPool.length})**`);
    for (const key of civPickPool) lines.push(`• ${CIV7_CIVS[key as keyof typeof CIV7_CIVS].gameId}`);
    lines.push('');
  }

  lines.push(`**Shared Leader Pool (${leadersPickPool.length})**`);
  for (const key of leadersPickPool) {
    const meta = request.edition === 'CIV6'
      ? CIV6_LEADERS[key as keyof typeof CIV6_LEADERS]
      : CIV7_LEADERS[key as keyof typeof CIV7_LEADERS];
    lines.push(`• ${meta.gameId}`);
  }

  return {
    content: lines.join('\n'),
    allowedMentions: { parse: [] as const },
  };
}
