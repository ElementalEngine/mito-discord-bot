import type { Guild, GuildMember, User, VoiceBasedChannel } from 'discord.js';

import type {
  BuildVoterListResult,
  MentionAdjustmentResult,
  VoterUser,
} from '../types/voice-voters.js';

const SNOWFLAKE_RE = /^\d{17,20}$/;
const MENTION_GLOBAL_RE = /<@!?(\d{17,20})>/g;

/**
 * Parse user mentions from free text.
 * Accepts `<@id>` and `<@!id>` formats.
 * Returns unique IDs in first-seen order.
 */
export function parseMentionedUserIds(raw: string | null | undefined): string[] {
  const text = (raw ?? '').trim();
  if (!text) return [];

  const ids: string[] = [];
  const seen = new Set<string>();

  for (const m of text.matchAll(MENTION_GLOBAL_RE)) {
    const id = m[1];
    if (!id || !SNOWFLAKE_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return ids;
}

/**
 * Apply mention rules to a base list.
 *
 * Rules:
 *  - base = voice channel non-bot user IDs
 *  - mentioned IN voice => remove from vote
 *  - mentioned NOT in voice => add to vote
 *  - stable order: keep base ordering; append added in mention order
 *  - dedup by ID
 */
export function applyMentionAdjustments(
  baseIds: readonly string[],
  mentionIds: readonly string[]
): MentionAdjustmentResult {
  const voiceSet = new Set(baseIds);

  const removeSet = new Set<string>();
  const added: string[] = [];
  const addedSet = new Set<string>();

  for (const id of mentionIds) {
    if (!SNOWFLAKE_RE.test(id)) continue;
    if (voiceSet.has(id)) {
      removeSet.add(id);
      continue;
    }
    if (addedSet.has(id)) continue;
    addedSet.add(id);
    added.push(id);
  }

  const kept = baseIds.filter((id) => !removeSet.has(id));
  const removed = baseIds.filter((id) => removeSet.has(id));

  return {
    voterIds: [...kept, ...added],
    removedIds: removed,
    addedIds: added,
  };
}

async function resolveUserWithName(
  guild: Guild,
  userId: string
): Promise<{ user: User; displayName: string } | null> {
  try {
    const m = await guild.members.fetch(userId);
    return { user: m.user, displayName: m.displayName };
  } catch {
    try {
      const u = await guild.client.users.fetch(userId);
      return { user: u, displayName: u.username };
    } catch {
      return null;
    }
  }
}

/**
 * Build the final voter list for a voice channel, applying optional mention adjustments.
 */
export async function buildVoiceChannelVoterList(
  guild: Guild,
  voiceChannel: VoiceBasedChannel,
  mentionsRaw: string | null | undefined
): Promise<BuildVoterListResult> {
  const mentionIds = parseMentionedUserIds(mentionsRaw);

  const baseMembers: GuildMember[] = [];
  for (const m of voiceChannel.members.values()) {
    if (m.user.bot) continue;
    baseMembers.push(m);
  }

  const baseIds = baseMembers.map((m) => m.id);
  const adjusted = applyMentionAdjustments(baseIds, mentionIds);

  const byId = new Map<string, VoterUser>();
  for (const m of baseMembers) {
    byId.set(m.id, { id: m.id, displayName: m.displayName, user: m.user });
  }

  // Resolve any added users (those not in the voice channel)
  for (const id of adjusted.addedIds) {
    if (byId.has(id)) continue;
    const resolved = await resolveUserWithName(guild, id);
    if (!resolved) continue;
    byId.set(id, { id, displayName: resolved.displayName, user: resolved.user });
  }

  const voters: VoterUser[] = [];
  for (const id of adjusted.voterIds) {
    const v = byId.get(id);
    if (v) voters.push(v);
  }

  return {
    voters,
    removedIds: adjusted.removedIds,
    addedIds: adjusted.addedIds,
  };
}
