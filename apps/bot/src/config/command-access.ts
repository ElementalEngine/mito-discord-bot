import { ApplicationCommandPermissionType, type ApplicationCommandPermissions } from 'discord.js';

import { config } from '../config.js';

// Who may run each command, and where. Discord's Integrations settings hold the
// live rules, set by an admin from this table; startup logs any difference.
// Every command needs a ranked role: unverified members see only Auth's.
type Channel = keyof typeof config.discord.channels;
type Role = keyof typeof config.discord.roles;

export type Access = Readonly<{
  // null: no restriction.
  roles: readonly Role[] | null;
  channels: readonly Channel[] | null;
  // Hidden from everyone until a role is granted it.
  staffOnly?: boolean;
}>;

const RANKED: readonly Role[] = ['civ6Rank', 'civ7Rank', 'civCloud', 'moderator', 'developer'];
const COMMAND_CHANNELS: readonly Channel[] = ['botTesting', 'civ6Commands', 'civ7Commands', 'cloudCommands', 'noviceCommands'];

export const COMMAND_ACCESS: Readonly<Record<string, Access>> = {
  'report-game': { roles: RANKED, channels: ['civ6realtimeUploads', 'civ7realtimeUploads', 'civ6cloudUploads', 'civ7cloudUploads'] },
  'report-remove': { roles: RANKED, channels: null },
  'report-revert': { roles: ['admin', 'developer'], channels: null, staffOnly: true },
  stats: { roles: RANKED, channels: COMMAND_CHANNELS },
  'stats-history': { roles: RANKED, channels: COMMAND_CHANNELS },
  roomranks: { roles: RANKED, channels: COMMAND_CHANNELS },
  resetstats: { roles: ['admin', 'noviceManager', 'developer'], channels: ['botTesting'], staffOnly: true },
  teamgen: { roles: RANKED, channels: COMMAND_CHANNELS },
  coinflip: { roles: RANKED, channels: COMMAND_CHANNELS },
  mapseed: {
    roles: RANKED,
    channels: ['botTesting', 'civ6Commands', 'civ7Commands', 'cloudCommands', 'civ6ffaVote', 'civ6teamerVote'],
  },
  'get-users': { roles: ['developer'], channels: ['botTesting'], staffOnly: true },
  'draft-civ6': { roles: RANKED, channels: ['botTesting', 'civ6Commands', 'noviceCommands', 'cloudCommands'] },
  'draft-civ7': { roles: RANKED, channels: ['botTesting', 'civ7Commands'] },
  // Each subcommand checks its own channel, so the command is open everywhere.
  lobby: { roles: RANKED, channels: null },
  secretvote: { roles: RANKED, channels: COMMAND_CHANNELS },
};

// The ids a command's access resolves to; an unset id is left out.
export type Wanted = Readonly<{ roles: string[] | null; channels: string[] | null; staffOnly: boolean }>;

const idsOf = <K extends string>(keys: readonly K[] | null, ids: Readonly<Record<K, string>>): string[] | null =>
  keys === null ? null : [...new Set(keys.map((k) => ids[k].trim()).filter(Boolean))].sort();

export function wantedFor(access: Access): Wanted {
  return {
    roles: idsOf(access.roles, config.discord.roles),
    channels: idsOf(access.channels, config.discord.channels),
    staffOnly: access.staffOnly === true,
  };
}

export type Drift = Readonly<{ kind: 'roles' | 'channels' | 'users'; want: string[] | null; have: string[] | null }>;

// What Discord's overrides allow, as the table states it: null for no
// restriction, and "!id" for one denied while the rest stay open.
function allowed(entries: readonly ApplicationCommandPermissions[], all: string, closed: boolean): string[] | null {
  if (closed || entries.some((e) => e.id === all && !e.permission)) {
    return entries.filter((e) => e.permission && e.id !== all).map((e) => e.id).sort();
  }
  const denied = entries.filter((e) => !e.permission && e.id !== all).map((e) => `!${e.id}`).sort();
  return denied.length ? denied : null;
}

const same = (a: string[] | null, b: string[] | null): boolean =>
  a === null || b === null ? a === b : a.length === b.length && a.every((x, i) => x === b[i]);

export function driftOf(want: Wanted, have: readonly ApplicationCommandPermissions[], guildId: string): Drift[] {
  const allChannels = String(BigInt(guildId) - 1n);
  const of = (type: ApplicationCommandPermissionType) => have.filter((e) => e.type === type);
  const roles = allowed(of(ApplicationCommandPermissionType.Role), guildId, want.staffOnly);
  const channels = allowed(of(ApplicationCommandPermissionType.Channel), allChannels, false);
  const users = of(ApplicationCommandPermissionType.User).map((e) => e.id).sort();
  return [
    ...(same(want.roles, roles) ? [] : [{ kind: 'roles' as const, want: want.roles, have: roles }]),
    ...(same(want.channels, channels) ? [] : [{ kind: 'channels' as const, want: want.channels, have: channels }]),
    ...(users.length ? [{ kind: 'users' as const, want: null, have: users }] : []),
  ];
}
