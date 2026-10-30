import type { CivVersion } from '../api/types.js';
import { config } from '../config.js';
import { MODES, MODE_NAMES, type Mode } from '../config/constants.js';
import { editionName } from '../utils/edition.js';

export type Leaderboard = Readonly<{
  name: string;
  game: CivVersion;
  game_type: 'PBC' | 'realtime';
  game_mode: string;
  is_seasonal: boolean;
  is_combined: boolean;
  thread_id: string;
}>;

const channels: Readonly<Record<string, string>> = config.discord.channels;

// A board's thread is the channel named after it: civ6RealtimeSeasonalFFALeaderboard.
function board(game: CivVersion, game_type: 'PBC' | 'realtime', mode: Mode | 'combined', seasonal: boolean): Leaderboard {
  const where = game_type === 'PBC' ? 'PBC' : 'Realtime';
  const season = seasonal ? 'Seasonal' : '';
  const key = `${game}${where}${season}${MODE_NAMES[mode]}Leaderboard`;
  const thread_id = channels[key];
  if (thread_id === undefined) throw new Error(`no channel ${key} in the config`);
  return {
    name: [editionName(game), where, season, MODE_NAMES[mode]].filter(Boolean).join('_'),
    game,
    game_type,
    game_mode: mode,
    is_seasonal: seasonal,
    is_combined: mode === 'combined',
    thread_id,
  };
}

const EDITIONS: readonly CivVersion[] = ['civ6', 'civ7'];

// The season boards first, then each edition's lifetime boards: Realtime by
// mode, and Cloud by mode with every mode combined.
export const leaderboardsList: readonly Leaderboard[] = [
  ...EDITIONS.flatMap((game) => MODES.map((mode) => board(game, 'realtime', mode, true))),
  ...EDITIONS.flatMap((game) => [
    ...MODES.map((mode) => board(game, 'realtime', mode, false)),
    ...MODES.map((mode) => board(game, 'PBC', mode, false)),
    board(game, 'PBC', 'combined', false),
  ]),
];
