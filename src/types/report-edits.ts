import type { GetMatchResponse } from '../api/types.js';

export type ReportEditsAction =
  | 'SUB_ASSIGN'
  | 'SUB_REMOVE'
  | 'DISCORD_ID'
  | 'ORDER'
  | 'TRIGGER_QUIT'
  | 'TRIGGER_LAGGER';

export type ReportEditsStage =
  | 'ACTION'
  | 'SUB_ASSIGN'
  | 'SUB_REMOVE'
  | 'DISCORD_ID'
  | 'ORDER'
  | 'TRIGGER';

export type ReportEditsTriggerKind = 'quit' | 'lagger';

export type ReportEditsOrderTargetKind = 'player' | 'team';

export type ReportEditsOrderDraft = {
  kind: ReportEditsOrderTargetKind;
  teamIds: number[]; // must be contiguous starting from 0
  placementsByTeamId: Record<number, number>; // 1..teamIds.length
};

export type ReportEditsState = {
  matchId: string;
  match: GetMatchResponse;
  initiatorId: string;
  isStaff: boolean;

  stage: ReportEditsStage;
  action: ReportEditsAction | null;

  // Sub assign
  subInIndex?: number; // 0-based index into match.players
  subOutDiscordId?: string;

  // Remove sub
  removeSubIndex?: number; // 0-based index into match.players (subbed_out slot)

  // Assign discord id
  discordIdSlotIndex?: number; // 0-based index into match.players
  discordIdPending?: string; // staged discord user id

  // Order
  orderDraft?: ReportEditsOrderDraft;
  orderSelectedTeamId?: number;
  orderSelectedPlacement?: number;

  // Trigger quit/lagger
  triggerKind?: ReportEditsTriggerKind;
  triggerDiscordId?: string;

  // last status message shown in embed
  lastNotice?: string;
};

export const REPORT_EDITS_COLLECTOR_IDLE_MS = 5 * 60_000;
