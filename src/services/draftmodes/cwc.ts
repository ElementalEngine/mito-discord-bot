import { EMOJI_FAIL } from '../../config/constants.js';
import { CWC_PICK_ORDER } from '../../config/draft.config.js';
import { CIV6_LEADERS } from '../../data/civ6.data.js';
import { CIV7_CIVS, CIV7_LEADERS } from '../../data/civ7.data.js';
import type { VoteDraftRequest } from '../../types/draft.js';
import { DraftError } from '../draft.service.js';
import type { DraftModeOutput } from '../../types/drafting.types.js';

function buildPickLines(roundLabel: string, pickCount: number): string[] {
  const lines = [`**${roundLabel}**`];
  for (let i = 0; i < pickCount; i += 1) {
    lines.push(`Pick ${i + 1}: Team ${CWC_PICK_ORDER[i] + 1}`);
  }
  return lines;
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

  const teamSize = request.voterIds.length / 2;
  if (!Number.isInteger(teamSize) || teamSize < 2 || teamSize > 8) {
    return {
      content: `${EMOJI_FAIL} CWC supports **2v2** through **8v8** only. Use Standard instead.`,
      allowedMentions: { parse: [] as const },
    };
  }

  const pickCount = request.voterIds.length;
  const bannedLeaders = new Set(request.bannedLeaderKeys);
  const bannedCivs = new Set(request.bannedCivKeys);

  const leaderPool = request.edition === 'CIV6'
    ? Object.keys(CIV6_LEADERS).filter((key) => !bannedLeaders.has(key))
    : Object.keys(CIV7_LEADERS).filter((key) => !bannedLeaders.has(key));

  const lines: string[] = ['**CWC draft** (shared pool)'];
  if (request.edition === 'CIV7') {
    lines.push(`Starting Age: **${request.startingAge ?? '—'}**`);
  }
  lines.push('');
  lines.push(...buildPickLines('Round 1 — Leaders', pickCount));

  if (request.edition === 'CIV7') {
    lines.push('');
    lines.push(...buildPickLines('Round 2 — Civs', pickCount));
  }

  lines.push('');
  lines.push(`**Shared Leader Pool (${leaderPool.length})**`);
  for (const key of leaderPool) {
    const meta = request.edition === 'CIV6'
      ? CIV6_LEADERS[key as keyof typeof CIV6_LEADERS]
      : CIV7_LEADERS[key as keyof typeof CIV7_LEADERS];
    lines.push(`• ${meta.gameId}`);
  }

  if (request.edition === 'CIV7') {
    const allowAllAges = request.startingAge === 'None';
    const civPool = Object.entries(CIV7_CIVS)
      .filter(([key, meta]) => !bannedCivs.has(key) && (allowAllAges || meta.agePool === request.startingAge))
      .map(([, meta]) => meta.gameId);
    lines.push('');
    lines.push(`**Shared Civ Pool (${civPool.length})**`);
    for (const civ of civPool) lines.push(`• ${civ}`);
  }

  return {
    content: lines.join('\n'),
    allowedMentions: { parse: [] as const },
  };
}
