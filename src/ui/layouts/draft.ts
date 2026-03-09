import { userMention } from 'discord.js';

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

function directLabel(kind: DraftGroupKind, index: number): string {
  return kind === 'Team' ? `Team n°${index + 1}` : `Player n°${index + 1}`;
}

function voteLabel(kind: DraftGroupKind, index: number, voterIds: readonly string[]): string {
  if (kind === 'Team') return `Team n°${index + 1}`;
  const voterId = voterIds[index];
  return voterId ? userMention(voterId) : `Player n°${index + 1}`;
}

function renderName(gameId: string | undefined, fallbackKey: string): string {
  return humanizeGameId(gameId ?? fallbackKey);
}

function splitSection(header: string, lines: readonly string[]): string[] {
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

function splitCiv7Section(
  header: string,
  leaderLines: readonly string[],
  civLines: readonly string[],
): string[] {
  const messages: string[] = [];
  let current = `${header}\nLeaders`;
  let sectionLabel = 'Leaders';

  for (const line of leaderLines) {
    const next = `${current}\n${line}`;
    if (next.length <= MAX_DISCORD_LEN) {
      current = next;
      continue;
    }

    messages.push(current);
    current = `${header} (cont.)\n${sectionLabel}\n${line}`;
  }

  if (civLines.length > 0) {
    const civHeader = `${current}\n\nCivs`;
    if (civHeader.length <= MAX_DISCORD_LEN) {
      current = civHeader;
    } else {
      messages.push(current);
      current = `${header} (cont.)\nCivs`;
    }
    sectionLabel = 'Civs';

    for (const line of civLines) {
      const next = `${current}\n${line}`;
      if (next.length <= MAX_DISCORD_LEN) {
        current = next;
        continue;
      }

      messages.push(current);
      current = `${header} (cont.)\n${sectionLabel}\n${line}`;
    }
  }

  if (current) messages.push(current);
  return messages;
}

function buildCiv6Section(draft: Civ6DraftResult, index: number, header: string): string[] {
  const lines: string[] = [];
  for (const key of draft.groups[index].leaders) {
    const meta = lookupCiv6LeaderMeta(key);
    lines.push(`${formatCiv6Leader(key)} ${renderName(meta?.gameId, key)}`);
  }
  return splitSection(header, lines);
}

function buildCiv7Section(draft: Civ7DraftResult, index: number, header: string): string[] {
  const group = draft.groups[index];
  const leaderLines: string[] = [];

  for (const key of group.leaders) {
    const meta = lookupCiv7LeaderMeta(key);
    leaderLines.push(`${formatCiv7Leader(key)} ${renderName(meta?.gameId, key)}`);
  }

  const civLines: string[] = [];
  for (const key of group.civs ?? []) {
    const meta = lookupCiv7CivMeta(key);
    civLines.push(`${formatCiv7Civ(key)} ${renderName(meta?.gameId, key)}`);
  }

  return splitCiv7Section(header, leaderLines, civLines);
}

export function buildCiv6DirectDraftMessages(draft: Civ6DraftResult): string[] {
  return draft.groups.flatMap((_, index) => buildCiv6Section(draft, index, directLabel(draft.allocation.groupKind, index)));
}

export function buildCiv7DirectDraftMessages(draft: Civ7DraftResult): string[] {
  return draft.groups.flatMap((_, index) => buildCiv7Section(draft, index, directLabel(draft.allocation.groupKind, index)));
}

export function buildCiv6VoteDraftMessages(draft: Civ6DraftResult, voterIds: readonly string[]): string[] {
  return draft.groups.flatMap((_, index) => buildCiv6Section(draft, index, voteLabel(draft.allocation.groupKind, index, voterIds)));
}

export function buildCiv7VoteDraftMessages(draft: Civ7DraftResult, voterIds: readonly string[]): string[] {
  return draft.groups.flatMap((_, index) => buildCiv7Section(draft, index, voteLabel(draft.allocation.groupKind, index, voterIds)));
}
