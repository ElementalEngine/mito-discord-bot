export const REPORT_EDITS_CID = {
  action: 're:action',

  subIn: 're:sub_in',
  subOut: 're:sub_out',
  removeSub: 're:remove_sub',

  discordSlot: 're:discord_slot',
  discordUser: 're:discord_user',
  discordEnter: 're:discord_enter',
  discordModal: 're:discord_modal',

  orderTeam: 're:order_team',
  orderPlacement: 're:order_place',

  triggerPlayer: 're:trigger_player',

  back: 're:back',
  apply: 're:apply',
  finish: 're:finish',
  cancel: 're:cancel',
} as const;

export type ReportEditsCustomId = (typeof REPORT_EDITS_CID)[keyof typeof REPORT_EDITS_CID];

export function isReportEditsCustomId(id: string): id is ReportEditsCustomId {
  return Object.values(REPORT_EDITS_CID).includes(id as ReportEditsCustomId);
}
