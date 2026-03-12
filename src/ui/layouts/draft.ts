import { MAX_DISCORD_LEN } from '../../config/constants.js';
import { formatCiv6Leader, lookupCiv6Leader } from '../../data/civ6.data.js';
import {
  formatCiv7Civ,
  formatCiv7Leader,
  lookupCiv7Civ,
  lookupCiv7Leader,
} from '../../data/civ7.data.js';
import type { Civ6DraftResult, Civ7DraftResult, DraftGroupKind } from '../../types/draft.types.js';

function labelForGroup(kind: DraftGroupKind, index: number): string {
  return kind === 'Team' ? `Team n°${index + 1}` : `Player n°${index + 1}`;
}

function splitSection(section: string): string[] {
  if (section.length <= MAX_DISCORD_LEN) {
    return [section];
  }

  const lines = section.split('\n');
  const header = lines[0] ?? '';
  const continuationHeader = header ? `${header} (cont.)` : '';
  const chunks: string[] = [];
  let current = '';

  for (const line of lines) {
    if (!current) {
      current = line;
      continue;
    }

    const next = `${current}\n${line}`;
    if (next.length <= MAX_DISCORD_LEN) {
      current = next;
      continue;
    }

    chunks.push(current);
    current = continuationHeader ? `${continuationHeader}\n${line}` : line;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function buildCiv6Section(draft: Civ6DraftResult, index: number): string {
  const lines: string[] = [labelForGroup(draft.allocation.groupKind, index)];

  for (const key of draft.groups[index].leaders) {
    lines.push(`${formatCiv6Leader(key)} ${lookupCiv6Leader(key)}`);
  }

  return lines.join('\n');
}

function buildCiv7Section(draft: Civ7DraftResult, index: number): string {
  const group = draft.groups[index];
  const lines: string[] = [
    labelForGroup(draft.allocation.groupKind, index),
    'Leaders',
  ];

  for (const key of group.leaders) {
    lines.push(`${formatCiv7Leader(key)} ${lookupCiv7Leader(key)}`);
  }

  lines.push('', 'Civs');
  for (const key of group.civs ?? []) {
    lines.push(`${formatCiv7Civ(key)} ${lookupCiv7Civ(key)}`);
  }

  return lines.join('\n');
}

export function buildCiv6DirectDraftMessages(draft: Civ6DraftResult): string[] {
  return draft.groups.flatMap((_, index) => splitSection(buildCiv6Section(draft, index)));
}

export function buildCiv7DirectDraftMessages(draft: Civ7DraftResult): string[] {
  return draft.groups.flatMap((_, index) => splitSection(buildCiv7Section(draft, index)));
}
