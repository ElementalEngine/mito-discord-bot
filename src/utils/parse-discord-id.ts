import { MENTION_ID_REGEX } from '../config/constants.js';

const SNOWFLAKE_RE = /^\d{17,20}$/;

export function parseDiscordUserId(input: string | null | undefined): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;

  if (SNOWFLAKE_RE.test(raw)) return raw;

  const m = raw.match(MENTION_ID_REGEX);
  const id = m?.[1];
  if (id && SNOWFLAKE_RE.test(id)) return id;
  return null;
}
