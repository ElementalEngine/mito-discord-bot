import type { RoomConfig } from '../session/index.js';
import type { GameVoteConfig } from '../shared/vote.types.js';
import type { DraftGameType } from '../shared/draft.types.js';
import type { CivEdition } from '../shared/civ.types.js';

export const DEV_DRAFT_MODES = ['standard', 'snake', 'blind', 'cwc'] as const;
export type DevDraftMode = (typeof DEV_DRAFT_MODES)[number];

export interface DevSessionParams {
  edition: CivEdition;
  gameType: DraftGameType;
  draftMode: DevDraftMode;
  hostId: string;
}

export function buildDevConfig(params: DevSessionParams): RoomConfig {
  const voteConfig: GameVoteConfig = {
    questions: [
      {
        id: 'draft_mode',
        title: 'Draft mode',
        defaultOptionId: params.draftMode,
        options: [{ id: params.draftMode, label: params.draftMode }],
      },
    ],
  };
  return {
    edition: params.edition,
    source: 'activity',
    mode: 'dev',
    gameType: params.gameType,
    guildId: 'dev-guild',
    hostId: params.hostId,
    voteConfig,
    ...(params.gameType === 'Teamer' ? { numberTeams: 2 } : {}),
  };
}

export function normalizeEdition(value: unknown): CivEdition {
  return value === 'CIV7' ? 'CIV7' : 'CIV6';
}

export function normalizeGameType(value: unknown): DraftGameType {
  return value === 'Teamer' || value === 'Duel' ? value : 'FFA';
}

export function normalizeDraftMode(value: unknown): DevDraftMode {
  return typeof value === 'string' && (DEV_DRAFT_MODES as readonly string[]).includes(value)
    ? (value as DevDraftMode)
    : 'standard';
}
