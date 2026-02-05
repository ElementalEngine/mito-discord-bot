// ── Mentions 
export const MAX_MENTIONS = 20 as const;

// Discord's max message length
export const MAX_DISCORD_LEN = 1999

// ── Emojis 
export const EMOJI_YES           = '👍';
export const EMOJI_NO            = '👎';
export const EMOJI_QUESTION      = '❓';
export const EMOJI_CANCEL        = '❌';
export const EMOJI_CONFIRM       = '✅';
export const EMOJI_ERROR         = '⚠️';
export const EMOJI_FAIL          = '‼️';
export const EMOJI_PARTICIPANTS  = '👥';
export const EMOJI_ROOM_RANKINGS = '📊';
export const EMOJI_FULL_G_REPORT = '📜';
export const EMOJI_QUITTER       = '🏳️';
export const EMOJI_REPORT        = '🧾';
export const EMOJI_FIRST_PLACE   = '🥇';
export const EMOJI_SECOND_PLACE  = '🥈';
export const EMOJI_THIRD_PLACE   = '🥉';
// - Custom emojis (use format `<:name:id>` in messages)
export const EMOJI_CIV6 = '<:civ6:1126980869014410240>';
export const EMOJI_CIV7 = '<:civ7:1126980867504417340>';

// ── Civilization save rules 
export const CIV_SAVE = {
  EXT: {
    CIV6: '.civ6save',
    CIV7: '.civ7save',
  },
  MAX_BYTES: 12 * 1024 * 1024, // 12 MB
} as const;

export type CivEdition = keyof typeof CIV_SAVE.EXT; // 'CIV6' | 'CIV7'
export const expectedExt = (edition: CivEdition) => CIV_SAVE.EXT[edition];

// ── Edit-report session timeout (ms)
export const EDIT_REPORT_TIMEOUT = 5 * 60 * 1000; // 5 minutes

export const MENTION_ID_REGEX = /<@!?(\d+)>/;