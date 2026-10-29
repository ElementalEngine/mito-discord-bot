// Discord's limits for a Components V2 message. A message over one is
// rejected whole, so text is trimmed here rather than refused there.
export const LIMITS = {
  components: 40,
  text: 4000,
  customId: 100,
} as const;

const ELLIPSIS = '\u2026';

export function fit(text: string, limit: number): string {
  if (limit < 1) return '';
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}${ELLIPSIS}`;
}
