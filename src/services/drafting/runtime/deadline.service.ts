export type DiscordTimestampStyle = 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R';

type AbsoluteTimestampStyle = Exclude<DiscordTimestampStyle, 'R'>;

export function formatDiscordTimestamp(ms: number, style: DiscordTimestampStyle): string {
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

export function formatDeadlineLine(
  endsAtMs: number,
  options: Readonly<{ label?: string; fixedStyle?: AbsoluteTimestampStyle; includeRelative?: boolean }> = {},
): string {
  const label = options.label ?? 'Deadline';
  const fixedStyle = options.fixedStyle ?? 't';
  const includeRelative = options.includeRelative ?? true;
  const fixed = formatDiscordTimestamp(endsAtMs, fixedStyle);
  return includeRelative
    ? `${label}: ${fixed} (${formatDiscordTimestamp(endsAtMs, 'R')})`
    : `${label}: ${fixed}`;
}
