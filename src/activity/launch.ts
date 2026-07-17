import { createRoomRecord } from '../session/index.js';
import type { RoomRecord } from '../session/index.js';
import type { ActivityBridge, ActivityLaunchParams, ActivityLaunchResult } from '../core/activity-bridge.js';
import { activityConfig } from './config.js';
import type { ActivityHub } from './hub.js';
import { buildDevConfig, normalizeEdition, normalizeGameType, normalizeDraftMode } from './dev-config.js';
import { createIdentityToken, createRoomAccessToken } from './auth/tokens.js';
import { randomBytes } from 'node:crypto';
import { warn as logWarn } from '../core/logging.js';

export interface LaunchBuildOptions {
  publicUrl: string;
  secret: string;
  identityTtlSeconds: number;
  roomAccessTtlSeconds: number;
}

/**
 * Pure launch assembly: build the room, mint the host's tokens, assemble the URL.
 * Returns the record to hand to the hub plus the result. Exposed for unit tests.
 */
export function buildLaunch(
  params: ActivityLaunchParams,
  options: LaunchBuildOptions,
): { record: RoomRecord; result: ActivityLaunchResult } | null {
  if (!options.publicUrl) return null;

  const sessionId = randomBytes(16).toString('hex');
  const config = buildDevConfig({
    edition: normalizeEdition(params.edition),
    gameType: normalizeGameType(params.gameType),
    draftMode: normalizeDraftMode(params.draftMode),
    hostId: params.hostUserId, // launcher = host
  });
  const record = createRoomRecord({ id: sessionId, config, createdAt: Date.now() });

  const identity = createIdentityToken(
    options.secret,
    { userId: params.hostUserId },
    { ttlSeconds: options.identityTtlSeconds },
  );
  const access = createRoomAccessToken(
    options.secret,
    { userId: params.hostUserId, sessionId },
    { ttlSeconds: options.roomAccessTtlSeconds },
  );

  const url = buildLaunchUrl(options.publicUrl, sessionId, identity, access);
  return { record, result: { sessionId, url } };
}

export function createActivityBridge(hub: ActivityHub): ActivityBridge {
  return {
    launch(params: ActivityLaunchParams): ActivityLaunchResult | null {
      const built = buildLaunch(params, {
        publicUrl: activityConfig.publicUrl,
        secret: activityConfig.sessionSecret,
        identityTtlSeconds: activityConfig.identityTtlSeconds,
        roomAccessTtlSeconds: activityConfig.roomAccessTtlSeconds,
      });
      if (!built) {
        logWarn('[activity] launch requested but ACTIVITY_PUBLIC_URL is not set - cannot build a link.');
        return null;
      }
      hub.createSession(built.record);
      logWarn(`[activity] launched session ${built.result.sessionId} (host ${params.hostUserId}, guild ${params.guildId})`);
      return built.result;
    },
  };
}

function buildLaunchUrl(base: string, sessionId: string, identity: string, access: string): string {
  const params = new URLSearchParams({ session: sessionId, identity, access });
  return `${base.replace(/\/+$/, '')}/?${params.toString()}`;
}
