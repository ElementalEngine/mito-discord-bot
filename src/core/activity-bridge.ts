export interface ActivityLaunchParams {
  guildId: string;
  hostUserId: string;
  edition: string;
  gameType: string;
  draftMode: string;
}

export interface ActivityLaunchResult {
  sessionId: string;
  url: string;
}

export interface ActivityBridge {
  launch(params: ActivityLaunchParams): ActivityLaunchResult | null;
}

let bridge: ActivityBridge | null = null;

export function setActivityBridge(implementation: ActivityBridge | null): void {
  bridge = implementation;
}

export function getActivityBridge(): ActivityBridge | null {
  return bridge;
}
