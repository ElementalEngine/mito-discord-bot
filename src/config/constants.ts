import type { CivEdition } from './types.js';

// - Discord limits + Helpers
export const MAX_MENTIONS = 20 as const;
export const MAX_DISCORD_LEN = 1999 as const;
export const MENTION_ID_REGEX = /<@!?(\d{17,20})>/;

// - Emojis (Unicode only — safe everywhere)
export const EMOJI_YES = '👍' as const;
export const EMOJI_NO = '👎' as const;
export const EMOJI_QUESTION = '❓' as const;
export const EMOJI_CANCEL = '❌' as const;
export const EMOJI_CONFIRM = '✅' as const;
export const EMOJI_ERROR = '⚠️' as const;
export const EMOJI_FAIL = '‼️' as const;
export const EMOJI_PARTICIPANTS = '👥' as const;
export const EMOJI_ROOM_RANKINGS = '📊' as const;
export const EMOJI_STATS = '📈' as const;
export const EMOJI_FULL_G_REPORT = '📜' as const;
export const EMOJI_QUITTER = '🏳️' as const;
export const EMOJI_REPORT = '🧾' as const;
export const EMOJI_LOCK = '🔒' as const;
export const EMOJI_VOTE_PANEL = '🗳️' as const;
export const EMOJI_RANDOM = '🎲' as const;
export const EMOJI_SNAKE = '🐍' as const;
export const EMOJI_FIRST_PLACE = '🥇' as const;
export const EMOJI_SECOND_PLACE = '🥈' as const;
export const EMOJI_THIRD_PLACE = '🥉' as const;

// - Game vote specific 
export const GAMEVOTE_CPL_STANDARD_RULES = [
  'Gold Trading: Not Allowed',
  'Luxuries Trading: Allowed',
  'Strategics Trading: Not Allowed',
  'Military Alliance: Not Allowed',
  'Timer: Competitive',
  'Resources: Abundant',
  'Strategics: Abundant',
  'Ridges Definition: Classic',
  'Wonders: Standard',
] as const;


// ─ Rank defs 
export const RANK_DEFS_CIV6 = [
  { name: 'Deity_3_STAR', threshold: 2400, color: '#ff0000' },
  { name: 'Deity_2_STAR', threshold: 2200, color: '#e60000' },
  { name: 'Deity',        threshold: 2000, color: '#c80000' },
  { name: 'Immortal',     threshold: 1800, color: '#e67e22' },
  { name: 'Emperor',      threshold: 1600, color: '#f1c40f' },
  { name: 'King',         threshold: 1500, color: '#00c0ff' },
  { name: 'Prince',       threshold: 1400, color: '#1abc9c' },
  { name: 'Warlord',      threshold: 1300, color: '#2ecc71' },
  { name: 'Chieftain',    threshold: 1200, color: '#1f8b4c' },
  { name: 'Settler',      threshold: 1100, color: '#11806a' },
  { name: 'Builder',      threshold: 1000, color: '#206694' },
  { name: 'Scout',        threshold: 0,    color: '#9d7cc4' },
] as const;

export type RankNames = (typeof RANK_DEFS_CIV6)[number]['name'];

// - Report defs
export const CIV_SAVE = {
  EXT: {
    CIV6: '.civ6save',
    CIV7: '.civ7save',
  },
  MAX_BYTES: 12 * 1024 * 1024, 
} as const;

export type { CivEdition } from './types.js';
export const expectedExt = (edition: CivEdition) => CIV_SAVE.EXT[edition];

export const EDIT_REPORT_TIMEOUT = 5 * 60 * 1000; 
