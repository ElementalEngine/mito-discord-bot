import {
  Guild,
  PermissionsBitField,
  type GuildMember,
  type Role,
} from 'discord.js';

import { config } from '../config.js';
import { RANK_DEFS_CIV6, type RankNames } from '../config/constants.js';

export type AffectedPlayerRating = {
  discord_id: string;
  rating_mu: number;
};

const RANK_DEFS = RANK_DEFS_CIV6;

function pickRankName(mu: number): RankNames {
  const score = Number.isFinite(mu) ? mu : -Infinity;
  for (const def of RANK_DEFS) {
    if (score >= def.threshold) return def.name;
  }
  return 'Scout';
}

function uniqueRatings(input: readonly AffectedPlayerRating[]): AffectedPlayerRating[] {
  const best = new Map<string, number>();
  for (const r of input) {
    const did = String(r.discord_id);
    const mu = Number(r.rating_mu);
    if (!did || !Number.isFinite(mu)) continue;
    const prev = best.get(did);
    if (prev === undefined || mu > prev) best.set(did, mu);
  }
  return [...best.entries()].map(([discord_id, rating_mu]) => ({ discord_id, rating_mu }));
}

function configuredRankRoleIds(): Record<RankNames, string> {
  return config.discord.rankRoles;
}

function collectManagedRoles(guild: Guild): {
  byName: Map<RankNames, Role>;
  managedIds: Set<string>;
  missingConfig: RankNames[];
  missingInGuild: RankNames[];
} {
  const idsByName = configuredRankRoleIds();

  const byName = new Map<RankNames, Role>();
  const managedIds = new Set<string>();
  const missingConfig: RankNames[] = [];
  const missingInGuild: RankNames[] = [];

  for (const def of RANK_DEFS) {
    const name = def.name;
    const id = idsByName[name];
    if (!id) {
      missingConfig.push(name);
      continue;
    }

    const role = guild.roles.cache.get(id);
    if (!role) {
      missingInGuild.push(name);
      continue;
    }

    byName.set(name, role);
    managedIds.add(role.id);
  }

  return { byName, managedIds, missingConfig, missingInGuild };
}

async function fetchMember(guild: Guild, discordId: string): Promise<GuildMember | null> {
  const cached = guild.members.cache.get(discordId);
  if (cached) return cached;

  try {
    return await guild.members.fetch(discordId);
  } catch {
    return null;
  }
}

async function ensureBotCanManageRoles(guild: Guild): Promise<boolean> {
  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!me) return false;

  return me.permissions.has(PermissionsBitField.Flags.ManageRoles);
}

async function applyRankRole(
  guild: Guild,
  member: GuildMember,
  desired: Role,
  managedRoleIds: ReadonlySet<string>,
): Promise<void> {
  const currentManaged = member.roles.cache.filter((r) => managedRoleIds.has(r.id));
  const hasDesired = currentManaged.has(desired.id);

  const toRemove = currentManaged
    .filter((r) => r.id !== desired.id)
    .map((r) => r.id);

  // Idempotent fast path.
  if (hasDesired && toRemove.length === 0) return;

  // Guard: role hierarchy.
  const desiredEditable = desired.editable;
  if (!desiredEditable) {
    console.warn(
      `[rank-roles] Cannot assign desired role due to hierarchy: guild=${guild.id} role=${desired.id}`,
    );
    return;
  }

  if (toRemove.length > 0) {
    const removable = toRemove.filter((id) => {
      const role = guild.roles.cache.get(id);
      return Boolean(role?.editable);
    });

    if (removable.length !== toRemove.length) {
      console.warn(
        `[rank-roles] Some roles not removable due to hierarchy: guild=${guild.id} member=${member.id}`,
      );
    }

    if (removable.length > 0) {
      await member.roles.remove(removable).catch((e: unknown) => {
        console.warn(
          `[rank-roles] Failed to remove roles: guild=${guild.id} member=${member.id}`,
          e,
        );
      });
    }
  }

  if (!hasDesired) {
    await member.roles.add(desired.id).catch((e: unknown) => {
      console.warn(
        `[rank-roles] Failed to add role: guild=${guild.id} member=${member.id} role=${desired.id}`,
        e,
      );
    });
  }
}

async function runBounded<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const limit = Math.max(1, Math.min(concurrency, 10));
  let idx = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const cur = items[idx];
      idx += 1;
      await worker(cur);
    }
  });

  await Promise.all(runners);
}

export async function updateRankRolesForApprovedMatch(
  guild: Guild,
  affectedPlayers: readonly AffectedPlayerRating[],
  opts: { concurrency?: number } = {},
): Promise<void> {
  if (!affectedPlayers.length) return;

  const canManage = await ensureBotCanManageRoles(guild);
  if (!canManage) {
    console.warn(`[rank-roles] Missing ManageRoles permission: guild=${guild.id}`);
    return;
  }

  const { byName, managedIds, missingConfig, missingInGuild } = collectManagedRoles(guild);
  if (missingConfig.length > 0) {
    console.warn(`[rank-roles] Missing rank role IDs in config: ${missingConfig.join(', ')}`);
  }
  if (missingInGuild.length > 0) {
    console.warn(`[rank-roles] Rank roles not found in guild: ${missingInGuild.join(', ')}`);
  }

  if (byName.size === 0 || managedIds.size === 0) return;

  const unique = uniqueRatings(affectedPlayers);

  await runBounded(unique, opts.concurrency ?? 3, async ({ discord_id, rating_mu }) => {
    const member = await fetchMember(guild, discord_id);
    if (!member) {
      console.warn(`[rank-roles] Member not found: guild=${guild.id} member=${discord_id}`);
      return;
    }

    const targetRank = pickRankName(rating_mu);
    const desiredRole = byName.get(targetRank);
    if (!desiredRole) {
      console.warn(
        `[rank-roles] Desired role missing: guild=${guild.id} rank=${targetRank} member=${discord_id}`,
      );
      return;
    }

    await applyRankRole(guild, member, desiredRole, managedIds);
  });
}
