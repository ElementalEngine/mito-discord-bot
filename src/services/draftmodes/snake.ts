import type { VoteDraftRequest } from '../../types/draft.js';
import { DraftError } from '../draft.service.js';
import type { DraftModeOutput } from '../../types/drafting.types.js';

export async function runSnakeDraftMode(request: VoteDraftRequest): Promise<DraftModeOutput> {
  if (request.source !== 'vote') {
    throw new DraftError('VALIDATION', 'Snake draft is only available from the vote flow.');
  }

  const order = request.voterIds.slice();
  const reversed = order.slice().reverse();

  const lines: string[] = [];
  lines.push(`**Snake draft order** (${request.edition === 'CIV6' ? 'leaders only' : 'leaders then civs'})`);
  lines.push('');
  lines.push(`Round 1 — Leaders: ${order.map((id, i) => `${i + 1}. <@${id}>`).join('  ')}`);

  if (request.edition === 'CIV7') {
    lines.push('');
    lines.push(`Round 2 — Civs (reverse): ${reversed.map((id, i) => `${i + 1}. <@${id}>`).join('  ')}`);
  }

  return {
    content: lines.join('\n'),
    allowedMentions: { parse: [] as const },
  };
}
