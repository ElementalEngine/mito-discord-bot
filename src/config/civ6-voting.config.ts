import type { DraftGameType } from '../types/drafting.types.js';
import type { VoteOption, VoteQuestion } from './types.js';

// Unicode helpers (safe everywhere)
const NB = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'] as const;
const LETTER = {
  A: '🇦',
  B: '🇧',
  C: '🇨',
  D: '🇩',
  E: '🇪',
  F: '🇫',
  G: '🇬',
  H: '🇭',
  I: '🇮',
  L: '🇱',
  M: '🇲',
  P: '🇵',
  R: '🇷',
  S: '🇸',
  T: '🇹',
} as const;

function q(
  id: string,
  title: string,
  options: readonly VoteOption[],
  defaultOptionId: string,
  maxSelections?: number
): VoteQuestion {
  return { id, title, options, defaultOptionId, maxSelections };
}

const VOTE_SETTINGS_FFA: readonly VoteQuestion[] = [
  q(
    'friends_allies',
    'Official Friends/Allies',
    [
      { id: 'none', emoji: NB[0], label: 'None' },
      { id: 'one', emoji: NB[1], label: 'One' },
      { id: 'two', emoji: NB[2], label: 'Two' },
      { id: 'unlimited', emoji: '♾️', label: 'Unlimited' },
    ],
    'none'
  ),
  q(
    'byc_mode',
    'BYC Mode (Capitals Only)',
    [
      { id: 'balanced', emoji: LETTER.B, label: 'Balanced' },
      { id: 'maximum', emoji: LETTER.M, label: 'Maximum' },
      { id: 'none', emoji: '⛔', label: 'None' },
    ],
    'balanced'
  ),
  q(
    'duration',
    'Game Duration',
    [
      { id: '4h', emoji: NB[4], label: '4 Hours' },
      { id: '6h', emoji: NB[6], label: '6 Hours' },
      { id: 'unlimited', emoji: '♾️', label: 'Unlimited' },
    ],
    '6h'
  ),
  q(
    'map',
    'Map',
    [
      { id: 'pangea_classic', emoji: LETTER.P, label: 'Pangea Classic Ridges' },
      { id: 'pangea_standard', emoji: '⛰️', label: 'Pangea Standard' },
      { id: 'pangaea_ultima', emoji: '🌐', label: 'Pangaea Ultima' },
      { id: 'primordial', emoji: '🌋', label: 'Primordial' },
      { id: 'seven_seas', emoji: NB[7], label: '7 Seas' },
      { id: 'continents_islands', emoji: '🏝️', label: 'Continents & Islands' },
      { id: 'highlands', emoji: '🏔️', label: 'Highlands' },
      { id: 'rich_highlands', emoji: '💰', label: 'Rich Highlands' },
      { id: 'lakes', emoji: LETTER.L, label: 'Lakes' },
      { id: 'tilted_axis', emoji: LETTER.T, label: 'Tilted Axis' },
      { id: 'inland_sea', emoji: '🌊', label: 'Inland Sea' },
      { id: 'fractal', emoji: LETTER.F, label: 'Fractal' },
      { id: 'island_plates', emoji: '🏖️', label: 'Island Plates' },
      { id: 'wetlands', emoji: '💦', label: 'Wetlands' },
      { id: 'terra', emoji: '🦖', label: 'Terra' },
    ],
    'pangea_standard',
    2
  ),
  q(
    'sea_level',
    'Sea Level',
    [
      { id: 'low', emoji: LETTER.L, label: 'Low' },
      { id: 'standard', emoji: LETTER.S, label: 'Standard' },
      { id: 'high', emoji: LETTER.H, label: 'High' },
    ],
    'standard'
  ),
  q(
    'disasters',
    'Disasters',
    [
      { id: '0', emoji: NB[0], label: '0' },
      { id: '1', emoji: NB[1], label: '1' },
      { id: '2', emoji: NB[2], label: '2' },
      { id: '3', emoji: NB[3], label: '3' },
      { id: '4', emoji: NB[4], label: '4' },
    ],
    '2'
  ),
  q(
    'barbarians',
    'Barbarians Mode',
    [
      { id: 'no_barbs', emoji: '⛔', label: 'No barbs' },
      { id: 'civilized', emoji: LETTER.C, label: 'Civilized barbs' },
      { id: 'balanced', emoji: LETTER.B, label: 'Balanced barbs' },
      { id: 'raging', emoji: LETTER.R, label: 'Raging barbs' },
    ],
    'balanced'
  ),
  q(
    'cc_voting',
    'CC Voting',
    [
      { id: 'minus10', emoji: '⬇️', label: '10 turns earlier' },
      { id: 'no_change', emoji: '⏺️', label: 'No change' },
      { id: 'plus10', emoji: '⬆️', label: '10 turns later' },
      { id: 'plus20', emoji: '⏫', label: '20 turns later' },
    ],
    'no_change'
  ),
];

const VOTE_SETTINGS_TEAMER: readonly VoteQuestion[] = [
  q(
    'remap_token',
    '1 Remap Token Per Team (T10)',
    [
      { id: 'yes', emoji: '✅', label: 'Yes' },
      { id: 'no', emoji: '⛔', label: 'No' },
    ],
    'yes'
  ),
  q(
    'byc_mode',
    'BYC Mode (Capitals Only)',
    [
      { id: 'balanced', emoji: LETTER.B, label: 'Balanced' },
      { id: 'maximum', emoji: LETTER.M, label: 'Maximum' },
      { id: 'none', emoji: '⛔', label: 'None' },
    ],
    'balanced'
  ),
  VOTE_SETTINGS_FFA.find((x) => x.id === 'map')!,
  q(
    'timer',
    'Timer',
    [
      { id: 'casual', emoji: '🐌', label: 'Casual' },
      { id: 'dynamic', emoji: '🕑', label: 'Dynamic' },
      { id: 'competitive', emoji: '⏩', label: 'Competitive' },
      { id: 'cwc', emoji: '👟', label: 'CWC-CIVLAN 2025' },
    ],
    'competitive'
  ),
  q(
    'resources',
    'Resources',
    [
      { id: 'standard', emoji: LETTER.S, label: 'Standard' },
      { id: 'abundant', emoji: LETTER.A, label: 'Abundant' },
    ],
    'abundant'
  ),
  q(
    'strategics',
    'Strategics',
    [
      { id: 'standard', emoji: LETTER.S, label: 'Standard' },
      { id: 'abundant', emoji: LETTER.A, label: 'Abundant' },
      { id: 'epic', emoji: LETTER.E, label: 'Epic' },
      { id: 'guaranteed', emoji: LETTER.G, label: 'Guaranteed' },
    ],
    'abundant'
  ),
  VOTE_SETTINGS_FFA.find((x) => x.id === 'sea_level')!,
  VOTE_SETTINGS_FFA.find((x) => x.id === 'disasters')!,
  q(
    'wonders',
    'Wonders',
    [
      { id: 'none', emoji: '⛔', label: 'None' },
      { id: 'scarce', emoji: '⬇️', label: 'Scarce' },
      { id: 'standard', emoji: '⏺️', label: 'Standard' },
      { id: 'abundant', emoji: '⬆️', label: 'Abundant' },
    ],
    'standard'
  ),
];

const DRAFT_MODES_FFA: readonly VoteOption[] = [
  { id: 'standard', emoji: '✅', label: 'Standard' },
  { id: 'snake', emoji: '🐍', label: 'Snake' },
  { id: 'blind', emoji: '🕶️', label: 'Blind' },
];

const DRAFT_MODES_TEAMER: readonly VoteOption[] = [
  { id: 'standard', emoji: '✅', label: 'Standard' },
  { id: 'cwc', emoji: '🌍', label: 'CWC (shared pool)' },
];

export const CIV6_VOTING_QUESTIONS: Readonly<Record<DraftGameType, readonly VoteQuestion[]>> = {
  FFA: VOTE_SETTINGS_FFA,
  Duel: VOTE_SETTINGS_FFA,
  Teamer: VOTE_SETTINGS_TEAMER,
};

export function getCiv6DraftModeQuestion(gameType: DraftGameType): VoteQuestion {
  const options = gameType === 'Teamer' ? DRAFT_MODES_TEAMER : DRAFT_MODES_FFA;
  return q('draft_mode', 'Draft Mode', options, 'standard');
}
