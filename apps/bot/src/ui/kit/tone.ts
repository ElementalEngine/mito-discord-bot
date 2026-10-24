// One colour and one emoji per outcome. The colours are the Activity's own
// (apps/activity/src/client/index.css), so the bot and the Activity match.
export const TONES = {
  info: { colour: 0xd4a13c, emoji: '\u2139\ufe0f' },
  success: { colour: 0x4b9e5f, emoji: '\u2705' },
  refused: { colour: 0xe07b39, emoji: '\u203c\ufe0f' },
  failed: { colour: 0xc4453c, emoji: '\u26a0\ufe0f' },
  muted: { colour: 0x9aa0aa, emoji: '\u25ab\ufe0f' },
} as const;

export type Tone = keyof typeof TONES;

// Each surface has one mark, shown in its title.
export const SURFACES = {
  lobby: '\ud83c\udfdb\ufe0f',
  report: '\ud83e\uddfe',
  stats: '\ud83d\udcc8',
  rooms: '\ud83d\udcca',
  leaderboard: '\ud83c\udfc6',
  draft: '\ud83d\udcdc',
  vote: '\ud83d\uddf3\ufe0f',
  secretvote: '\ud83d\udd0e',
  teams: '\u2696\ufe0f',
  coin: '\ud83e\ude99',
  seed: '\ud83d\uddfa\ufe0f',
  users: '\ud83d\udc65',
  season: '\ud83d\udcc5',
} as const;

export type Surface = keyof typeof SURFACES;
