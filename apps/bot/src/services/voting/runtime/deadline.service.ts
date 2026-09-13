export function toDiscordTimeTag(endsAtMs: number): string {
  return `<t:${Math.floor(endsAtMs / 1000)}:t>`;
}
