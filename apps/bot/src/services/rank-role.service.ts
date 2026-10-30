import { PermissionsBitField, type Guild, type GuildMember, type Role } from 'discord.js';

import type { AffectedPlayerRating } from '../api/types.js';
import { config } from '../config.js';
import { RANK_DEFS_CIV6, rankOf, type RankNames } from '../config/constants.js';
import { log } from '../utils/log.js';

// Each player's rank role, from the rating core-api says it follows, after an
// approve, a revert or a reset. A failure is logged; the caller carries on.
export async function syncRankRoles(guild: Guild, affected: readonly AffectedPlayerRating[] | null | undefined, context: string): Promise<void> {
  if (!affected?.length) return;
  await setRankRoles(guild, affected).catch((error: unknown) => {
    log.warn('rank roles not synced', context, error instanceof Error ? error.message : error);
  });
}

// The rank roles the guild holds, by rank name; the ones it lacks are logged.
function rankRoles(guild: Guild): Map<RankNames, Role> {
  const roles = new Map<RankNames, Role>();
  const missing: string[] = [];
  for (const { name } of RANK_DEFS_CIV6) {
    const role = guild.roles.cache.get(config.discord.rankRoles[name]);
    if (role) roles.set(name, role);
    else missing.push(name);
  }
  if (missing.length) log.warn(`rank roles not set up in guild ${guild.id}: ${missing.join(', ')}`);
  return roles;
}

// A player's best rating, where one approve moved them more than once.
function bestRatings(affected: readonly AffectedPlayerRating[]): Map<string, number> {
  const best = new Map<string, number>();
  for (const { discord_id, rating_mu } of affected) {
    if (Number.isFinite(rating_mu) && rating_mu > (best.get(discord_id) ?? -Infinity)) best.set(discord_id, rating_mu);
  }
  return best;
}

async function setRankRoles(guild: Guild, affected: readonly AffectedPlayerRating[]): Promise<void> {
  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    log.warn(`rank roles need Manage Roles in guild ${guild.id}`);
    return;
  }
  const roles = rankRoles(guild);
  if (!roles.size) return;
  const managed = new Set([...roles.values()].map((r) => r.id));
  for (const [discordId, mu] of bestRatings(affected)) {
    const member = await guild.members.fetch(discordId).catch(() => null);
    const wanted = roles.get((rankOf(mu) ?? RANK_DEFS_CIV6.at(-1)!).name);
    if (!member || !wanted) {
      log.warn(`rank role not applied: member ${discordId} ${member ? 'has no role for their rank' : 'not in the guild'}`);
      continue;
    }
    await applyRankRole(member, wanted, managed).catch((error: unknown) => {
      log.warn(`rank role not applied: member ${discordId}`, error instanceof Error ? error.message : error);
    });
  }
}

// The member keeps the one rank role they are due; the others the bot manages go.
async function applyRankRole(member: GuildMember, wanted: Role, managed: ReadonlySet<string>): Promise<void> {
  const held = member.roles.cache.filter((r) => managed.has(r.id));
  const extra = held.filter((r) => r.id !== wanted.id);
  if (held.has(wanted.id) && !extra.size) return;
  if (!wanted.editable || extra.some((r) => !r.editable)) {
    log.warn(`rank roles above the bot's in guild ${member.guild.id}: member ${member.id} left as they are`);
    return;
  }
  if (extra.size) await member.roles.remove(extra.map((r) => r.id));
  if (!held.has(wanted.id)) await member.roles.add(wanted.id);
}
