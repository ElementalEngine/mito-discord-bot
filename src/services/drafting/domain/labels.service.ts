import type { DraftGroupKind } from '../../../types/drafting.types.js';
import { humanizeGameId } from '../../../utils/humanize-game-id.js';

const EMOJI_NAME_SAFE_RE = /[^A-Za-z0-9_]/g;

export function sanitizeEmojiName(name: string): string {
  const cleaned = name.replace(EMOJI_NAME_SAFE_RE, '_').replace(/_+/g, '_');
  const trimmed = cleaned.replace(/^_+|_+$/g, '');
  return trimmed.length >= 2 ? trimmed.slice(0, 32) : 'civ';
}

function titleCaseWord(w: string): string {
  if (!w) return w;
  if (/^[IVX]+$/.test(w)) return w;
  if (w.length <= 3 && w === w.toUpperCase()) return w;
  return w[0].toUpperCase() + w.slice(1).toLowerCase();
}

export function humanizeDraftKey(key: string): string {
  const stripped = key
    .replace(/^LEADER_/, '')
    .replace(/^CIVILIZATION_/, '')
    .trim();

  return stripped
    .split('_')
    .filter(Boolean)
    .map(titleCaseWord)
    .join(' ');
}

export function labelForVoteGroup(kind: DraftGroupKind, index: number): string {
  return kind === 'Team' ? `Team ${index + 1}` : `Player ${index + 1}`;
}

export function labelForDirectGroup(kind: DraftGroupKind, index: number): string {
  return kind === 'Team' ? `Team n°${index + 1}` : `Player n°${index + 1}`;
}

export function renderEmojiReadableLine(
  meta: Readonly<{ gameId: string; emojiId?: string }> | undefined,
  fallbackKey: string,
): string {
  if (!meta) return humanizeDraftKey(fallbackKey);

  const name = meta.gameId;
  const emojiId = meta.emojiId?.trim();
  if (!emojiId) return name;

  return `<:${sanitizeEmojiName(meta.gameId)}:${emojiId}> ${name}`;
}


export function renderEmojiHumanizedLine(
  meta: Readonly<{ gameId: string; emojiId?: string }> | undefined,
  fallbackKey: string,
): string {
  if (!meta) return humanizeDraftKey(fallbackKey);

  const label = humanizeGameId(meta.gameId);
  const emojiId = meta.emojiId?.trim();
  if (!emojiId) return label;

  return `<:${sanitizeEmojiName(meta.gameId)}:${emojiId}> ${label}`;
}

export function renderMentionHumanizedSingleLine(
  userId: string,
  meta: Readonly<{ gameId: string; emojiId?: string }> | undefined,
  fallbackKey: string,
): string {
  return `• <@${userId}> — ${renderEmojiHumanizedLine(meta, fallbackKey)}`;
}

export function renderMentionHumanizedPairLine(
  userId: string,
  first: Readonly<{ gameId: string; emojiId?: string }> | undefined,
  firstKey: string,
  second: Readonly<{ gameId: string; emojiId?: string }> | undefined,
  secondKey: string,
): string {
  return `• <@${userId}> — ${renderEmojiHumanizedLine(first, firstKey)} + ${renderEmojiHumanizedLine(second, secondKey)}`;
}
