import type { CorsOptions } from 'cors';
import { config as dotenvConfig } from 'dotenv';
import path from 'node:path';

export * from './config/constants.js';

// Env loading
const nodeEnv = (process.env.NODE_ENV ?? 'development') as
  | 'development'
  | 'production'

dotenvConfig({
  path: path.resolve(`.env.${nodeEnv}`),
});

const env = (key: string, fallback = ''): string => process.env[key] ?? fallback;
const host = process.env.HOST!;
const port = Number(process.env.PORT!);

// CORS
const corsOriginRaw = env('CORS', '*').trim();
const corsOrigin =
  corsOriginRaw === '*'
    ? '*'
    : corsOriginRaw.split(',').map((s) => s.trim()).filter(Boolean);

const cors: CorsOptions = {
  origin: corsOrigin,
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  credentials: corsOriginRaw !== '*',
  exposedHeaders: ['x-auth-token'],
};

// Discord
const discord = {
  clientId: env('BOT_CLIENT_ID'),
  clientSecret: env('BOT_CLIENT_SECRET'),
  guildId: env('DISCORD_GUILD_ID'),
  token: env('BOT_TOKEN'),

  channels: {
    botTesting: process.env.CHANNEL_BOT_COMMANDS_ID!,

    civ6Commands: env('CHANNEL_CIV6_COMMANDS_ID'),
    civ7Commands: env('CHANNEL_CIV7_COMMANDS_ID'),
    cloudCommands: env('CHANNEL_CLOUD_COMMANDS_ID'),

    civ6realtimeUploads: env('CHANNEL_CIV6_REALTIME_UPLOADS_ID'),
    civ7realtimeUploads: env('CHANNEL_CIV7_REALTIME_UPLOADS_ID'),
    civ6cloudUploads: env('CHANNEL_CIV6_CLOUD_UPLOADS_ID'),
    civ7cloudUploads: env('CHANNEL_CIV7_CLOUD_UPLOADS_ID'),

    civ6realtimeReportingHistory: env('CHANNEL_CIV6_REALTIME_REPORTING_HISTORY_ID'),
    civ7realtimeReportingHistory: env('CHANNEL_CIV7_REALTIME_REPORTING_HISTORY_ID'),
    civ6cloudReportingHistory: env('CHANNEL_CIV6_CLOUD_REPORTING_HISTORY_ID'),
    civ7cloudReportingHistory: env('CHANNEL_CIV7_CLOUD_REPORTING_HISTORY_ID'),

    civ6RealtimeFFALeaderboard: env('CHANNEL_CIV6_REALTIME_FFA_LEADERBOARD_ID'),
    civ6RealtimeDuelLeaderboard: env('CHANNEL_CIV6_REALTIME_DUEL_LEADERBOARD_ID'),
    civ6RealtimeTeamerLeaderboard: env('CHANNEL_CIV6_REALTIME_TEAMER_LEADERBOARD_ID'),
    civ6RealtimeSeasonalFFALeaderboard: env('CHANNEL_CIV6_REALTIME_SEASONAL_FFA_LEADERBOARD_ID'),
    civ6RealtimeSeasonalDuelLeaderboard: env('CHANNEL_CIV6_REALTIME_SEASONAL_DUEL_LEADERBOARD_ID'),
    civ6RealtimeSeasonalTeamerLeaderboard: env('CHANNEL_CIV6_REALTIME_SEASONAL_TEAMER_LEADERBOARD_ID'),

    civ6PBCFFALeaderboard: env('CHANNEL_CIV6_PBC_FFA_LEADERBOARD_ID'),
    civ6PBCDuelLeaderboard: env('CHANNEL_CIV6_PBC_DUEL_LEADERBOARD_ID'),
    civ6PBCTeamerLeaderboard: env('CHANNEL_CIV6_PBC_TEAMER_LEADERBOARD_ID'),
    civ6PBCCombinedLeaderboard: env('CHANNEL_CIV6_PBC_COMBINED_LEADERBOARD_ID'),

    civ7RealtimeFFALeaderboard: env('CHANNEL_CIV7_REALTIME_FFA_LEADERBOARD_ID'),
    civ7RealtimeDuelLeaderboard: env('CHANNEL_CIV7_REALTIME_DUEL_LEADERBOARD_ID'),
    civ7RealtimeTeamerLeaderboard: env('CHANNEL_CIV7_REALTIME_TEAMER_LEADERBOARD_ID'),
    civ7RealtimeSeasonalFFALeaderboard: env('CHANNEL_CIV7_REALTIME_SEASONAL_FFA_LEADERBOARD_ID'),
    civ7RealtimeSeasonalDuelLeaderboard: env('CHANNEL_CIV7_REALTIME_SEASONAL_DUEL_LEADERBOARD_ID'),
    civ7RealtimeSeasonalTeamerLeaderboard: env('CHANNEL_CIV7_REALTIME_SEASONAL_TEAMER_LEADERBOARD_ID'),

    civ7PBCFFALeaderboard: env('CHANNEL_CIV7_PBC_FFA_LEADERBOARD_ID'),
    civ7PBCDuelLeaderboard: env('CHANNEL_CIV7_PBC_DUEL_LEADERBOARD_ID'),
    civ7PBCTeamerLeaderboard: env('CHANNEL_CIV7_PBC_TEAMER_LEADERBOARD_ID'),
    civ7PBCCombinedLeaderboard: env('CHANNEL_CIV7_PBC_COMBINED_LEADERBOARD_ID'),
  },

  roles: {
    moderator: process.env.ROLE_MODERATOR!,
    developer: process.env.ROLE_DEVELOPER!,
    noviceManager: process.env.ROLE_NOVICE_MANAGER!,
    civ6Rank: process.env.ROLE_CIV6_RANKED!,
    civ7Rank: process.env.ROLE_CIV7_RANKED!,
    civCloud: process.env.ROLE_CLOUD!,
    novice: process.env.ROLE_NOVICE!,
  },
};

// Backend URL 
const redirectUri = `http://${host}:${port}`;
const backendDefault =
  nodeEnv === 'production' ? 'http://localhost:8000' : 'http://localhost:8001';

// Final config export  
export const config = {
  oauth:
    `https://discord.com/api/oauth2/authorize?client_id=${discord.clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code&scope=identify%20connections&state=`,
  cors,
  discord,
  host,
  port,
  backend: {
    url: env('BACKEND_SERVICE_URL', backendDefault),
  },
  env: (process.env.NODE_ENV as 'development' | 'production') ?? 'development',
  rateLimit: {
    windowMs: Number(env('RATE_LIMIT_WINDOW_MS', String(15 * 60 * 1000))),
    max: Number(env('RATE_LIMIT_MAX', '100')),
  },
} as const;
