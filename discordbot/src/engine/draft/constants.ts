export type EngineDraftTimersMs = Readonly<{
  blind: number;
  snakePick: number;
  cwcCaptainSelect: number;
  cwcPick: number;
}>;

export const ENGINE_DRAFT_TIMERS_MS: EngineDraftTimersMs = {
  blind: 10 * 60_000,
  snakePick: 3 * 60_000,
  cwcCaptainSelect: 5 * 60_000,
  cwcPick: 60_000,
} as const;

/** Team index sequence for CWC picks; a prefix of length teamSize*2 is used. */
export const ENGINE_CWC_PICK_ORDER = [0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1] as const;
