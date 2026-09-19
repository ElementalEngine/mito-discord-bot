import { config as dotenvConfig } from 'dotenv';
import path from 'node:path';

const nodeEnv = process.env.NODE_ENV === 'production' ? 'production' : 'development';
dotenvConfig({ path: path.resolve(`.env.${nodeEnv}`) });

const REQUIRED = [
  'CORE_API_URL',
  'ACTIVITY_SERVICE_TOKEN',
  'ACTIVITY_SESSION_SIGNING_KEY',
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_GUILD_ID',
] as const;

const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(`activity: missing env ${missing.join(', ')}`);
}

const need = (key: (typeof REQUIRED)[number]): string => process.env[key] as string;

function strongKey(key: string): string {
  if (key.length < 32) throw new Error('activity: ACTIVITY_SESSION_SIGNING_KEY must be at least 32 characters');
  return key;
}

export const config = {
  env: nodeEnv,
  port: Number(process.env.PORT ?? '3000'),
  coreApiUrl: need('CORE_API_URL').replace(/\/+$/, ''),
  // The two secrets never meet: the Bearer goes outbound only, the signing
  // key never leaves the process.
  coreApiToken: need('ACTIVITY_SERVICE_TOKEN'),
  sessionSigningKey: strongKey(need('ACTIVITY_SESSION_SIGNING_KEY')),
  discord: {
    clientId: need('DISCORD_CLIENT_ID'),
    clientSecret: need('DISCORD_CLIENT_SECRET'),
    guildId: need('DISCORD_GUILD_ID'),
  },
  staffRoleIds: (process.env.STAFF_ROLE_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
} as const;
