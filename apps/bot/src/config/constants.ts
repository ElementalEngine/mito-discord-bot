import type { CivEdition } from './types.js';

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
