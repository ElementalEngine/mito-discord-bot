import type { DraftGameType } from '../types/drafting.types.js';
import type { VoteOption, VoteQuestion } from './types.js';

import { getCiv6DraftModeQuestion } from './civ6-voting.config.js';

function q(
  id: string,
  title: string,
  options: readonly VoteOption[],
  defaultOptionId: string,
  maxSelections?: number,
): VoteQuestion {
  return { id, title, options, defaultOptionId, maxSelections };
}

const CIV7_VOTE_SETTINGS: readonly VoteQuestion[] = [
  q(
    'turn_timer',
    'Turn Timer',
    [
      { id: 'none', emoji: '⛔', label: 'None' },
      { id: 'standard_120', emoji: '⏱️', label: 'Standard 120' },
      { id: 'dynamic', emoji: '🔄', label: 'Dynamic' },
    ],
    'standard_120',
  ),
  q(
    'game_speed',
    'Game Speed',
    [
      { id: 'online', emoji: '⚡', label: 'Online' },
      { id: 'quick', emoji: '🏃', label: 'Quick' },
      { id: 'standard', emoji: '⏺️', label: 'Standard' },
      { id: 'epic', emoji: '🐢', label: 'Epic' },
      { id: 'marathon', emoji: '🏁', label: 'Marathon' },
    ],
    'standard',
  ),
  q(
    'age_length',
    'Age Length',
    [
      { id: 'abbreviated', emoji: '✂️', label: 'Abbreviated' },
      { id: 'standard', emoji: '⏺️', label: 'Standard' },
      { id: 'long', emoji: '📏', label: 'Long' },
    ],
    'standard',
  ),
  q(
    'end_age_countdown',
    'End Age Countdown',
    [
      { id: 'none', emoji: '⛔', label: 'None' },
      { id: '10', emoji: '🔟', label: '10' },
      { id: '20', emoji: '2️⃣0️⃣', label: '20' },
    ],
    '10',
  ),
  q(
    'age_transition',
    'Age Transition',
    [
      { id: 'continuity', emoji: '🔗', label: 'Continuity' },
      { id: 'regroup', emoji: '🤝', label: 'Regroup' },
    ],
    'continuity',
  ),
  q(
    'no_age_transition',
    'No Age Transition',
    [
      { id: 'enabled', emoji: '✅', label: 'Enabled' },
      { id: 'disabled', emoji: '⛔', label: 'Disabled' },
    ],
    'disabled',
  ),
  q(
    'start_position',
    'Start Position',
    [
      { id: 'balanced', emoji: '⚖️', label: 'Balanced' },
      { id: 'standard', emoji: '⏺️', label: 'Standard' },
    ],
    'balanced',
  ),
  q(
    'map_type',
    'Map Type',
    [
      { id: 'continents_plus', emoji: '🌍', label: 'Continents Plus' },
      { id: 'continents', emoji: '🌎', label: 'Continents' },
      { id: 'archipelago', emoji: '🏝️', label: 'Archipelago' },
      { id: 'fractal', emoji: '🌀', label: 'Fractal' },
      { id: 'shuffle', emoji: '🔀', label: 'Shuffle' },
      { id: 'terra_incognita', emoji: '🧭', label: 'Terra Incognita' },
      { id: 'pangea_plus', emoji: '🗺️', label: 'Pangea Plus' },
      { id: 'continents_and_islands', emoji: '🌊', label: 'Continents and Islands' },
      { id: 'pangea_and_islands', emoji: '🏖️', label: 'Pangea and Islands' },
      { id: 'shattered_seas', emoji: '💥', label: 'Shattered Seas' },
    ],
    'continents_plus',
  ),
  q(
    'map_size',
    'Map Size',
    [
      { id: 'tiny', emoji: '🤏', label: 'Tiny' },
      { id: 'small', emoji: '📐', label: 'Small' },
      { id: 'standard', emoji: '⏺️', label: 'Standard' },
      { id: 'large', emoji: '📏', label: 'Large' },
      { id: 'huge', emoji: '🌐', label: 'Huge' },
    ],
    'standard',
  ),
  q(
    'mementos',
    'Mementos',
    [
      { id: 'enabled', emoji: '✅', label: 'Enabled' },
      { id: 'disabled', emoji: '⛔', label: 'Disabled' },
    ],
    'enabled',
  ),
  q(
    'difficulty',
    'Difficulty',
    [
      { id: 'scribe', emoji: '✍️', label: 'Scribe' },
      { id: 'governor', emoji: '🏛️', label: 'Governor' },
      { id: 'viceroy', emoji: '🎖️', label: 'Viceroy' },
      { id: 'sovereign', emoji: '👑', label: 'Sovereign' },
      { id: 'immortal', emoji: '💀', label: 'Immortal' },
      { id: 'deity', emoji: '⚡', label: 'Deity' },
      { id: 'custom', emoji: '🛠️', label: 'Custom' },
    ],
    'sovereign',
  ),
  q(
    'disaster_frequency',
    'Disaster Frequency',
    [
      { id: 'light', emoji: '🌤️', label: 'Light' },
      { id: 'moderate', emoji: '🌩️', label: 'Moderate' },
      { id: 'catastrophic', emoji: '🌋', label: 'Catastrophic' },
    ],
    'moderate',
  ),
];

export const CIV7_VOTING_QUESTIONS: Readonly<Record<DraftGameType, readonly VoteQuestion[]>> = {
  FFA: [...CIV7_VOTE_SETTINGS],
  Duel: [...CIV7_VOTE_SETTINGS],
  Teamer: [...CIV7_VOTE_SETTINGS],
};

export function getCiv7DraftModeQuestion(gameType: DraftGameType): VoteQuestion {
  return getCiv6DraftModeQuestion(gameType);
}
