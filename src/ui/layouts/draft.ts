import { MAX_DISCORD_LEN } from '../../config/constants.js';
import { formatCiv6Leader, lookupCiv6LeaderMeta } from '../../data/civ6.data.js';
import {
  formatCiv7Civ,
  formatCiv7Leader,
  lookupCiv7CivMeta,
  lookupCiv7LeaderMeta,
} from '../../data/civ7.data.js';
import type { Civ6DraftResult, Civ7DraftResult, DraftGroupKind } from '../../types/draft.js';
import { humanizeGameId } from '../../utils/humanize-game-id.js';

function labelForGroup(kind: DraftGroupKind, index: number): string {
  return kind === 'Team' ? `Team n°${index + 1}` : `Player n°${index + 1}`;
}

function renderName(gameId: string | undefined, fallbackKey: string): string {
  return humanizeGameId(gameId ?? fallbackKey);
}

function splitLongSection(section: string): string[] {
  if (section.length <= MAX_DISCORD_LEN) return [section];

  const lines = section.split('\n');
  const header = lines.shift() ?? 'Draft';
  const messages: string[] = [];
  let current = header;

  for (const line of lines) {
    const next = `${current}\n${line}`;
    if (next.length <= MAX_DISCORD_LEN) {
      current = next;
      continue;
    }

    messages.push(current);
    current = `${header} (cont.)\n${line}`;
  }

  if (current) messages.push(current);
  return messages;
}

function buildCiv6Section(draft: Civ6DraftResult, index: number): string {
  const lines: string[] = [labelForGroup(draft.allocation.groupKind, index)];

  for (const key of draft.groups[index].leaders) {
    const meta = lookupCiv6LeaderMeta(key);
    lines.push(`${formatCiv6Leader(key)} ${renderName(meta?.gameId, key)}`);
  }

  return lines.join('\n');
}

function buildCiv7Section(draft: Civ7DraftResult, index: number): string {
  const group = draft.groups[index];
  const lines: string[] = [labelForGroup(draft.allocation.groupKind, index), 'Leaders'];

  for (const key of group.leaders) {
    const meta = lookupCiv7LeaderMeta(key);
    lines.push(`${formatCiv7Leader(key)} ${renderName(meta?.gameId, key)}`);
  }

  lines.push('', 'Civs');
  for (const key of group.civs ?? []) {
    const meta = lookupCiv7CivMeta(key);
    lines.push(`${formatCiv7Civ(key)} ${renderName(meta?.gameId, key)}`);
  }

  return lines.join('\n');
}

export function buildCiv6DirectDraftMessages(draft: Civ6DraftResult): string[] {
  return draft.groups.flatMap((_, index) => splitLongSection(buildCiv6Section(draft, index)));
}

export function buildCiv7DirectDraftMessages(draft: Civ7DraftResult): string[] {
  return draft.groups.flatMap((_, index) => splitLongSection(buildCiv7Section(draft, index)));
}
