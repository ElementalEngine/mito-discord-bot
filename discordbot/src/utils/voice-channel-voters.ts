import type { Guild, GuildMember, VoiceBasedChannel } from 'discord.js';
import type { BuildVoiceChannelVotersResult, VoterUser } from './types.js';

const SNOWFLAKE_RE = /^\d{17,20}$/;
const MENTION_RE = /<@!?(\d{17,20})>/g;
const MEMBER_FETCH_CONCURRENCY = 4;

function uniqMentionIdsInOrder(raw: string | null | undefined): string[] {
  const text = (raw ?? '').trim();
  if (!text) return [];

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(MENTION_RE)) {
    const id = m[1];
    if (!id || !SNOWFLAKE_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

async function resolveUser(
  guild: Guild,
  userId: string
): Promise<{ user: GuildMember['user']; displayName: string } | null> {
  try {
    const member = await guild.members.fetch(userId);
    if (member.user.bot) return null;
    return { user: member.user, displayName: member.displayName };
  } catch {
    return null;
  }
}

function baseVoiceMembers(voiceChannel: VoiceBasedChannel): GuildMember[] {
  const out: GuildMember[] = [];
  for (const m of voiceChannel.members.values()) {
    if (!m.user.bot) out.push(m);
  }
  return out;
}

async function forEachLimit<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  const concurrency = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      await fn(items[index]);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

export async function buildVoiceChannelVoters(
  guild: Guild,
  voiceChannel: VoiceBasedChannel,
  mentionsRaw: string | null | undefined
): Promise<BuildVoiceChannelVotersResult> {
  const base = baseVoiceMembers(voiceChannel);
  const baseIds = base.map((m) => m.id);
  const baseSet = new Set(baseIds);

  const mentionIds = uniqMentionIdsInOrder(mentionsRaw);
  const removeSet = new Set<string>();
  const addIds: string[] = [];
  const addSet = new Set<string>();

  for (const id of mentionIds) {
    if (baseSet.has(id)) {
      removeSet.add(id);
      continue;
    }
    if (!addSet.has(id)) {
      addSet.add(id);
      addIds.push(id);
    }
  }

  const voterIds = [...baseIds.filter((id) => !removeSet.has(id)), ...addIds];

  const byId = new Map<string, VoterUser>();
  for (const m of base) {
    byId.set(m.id, { id: m.id, displayName: m.displayName, user: m.user });
  }

  await forEachLimit(addIds, MEMBER_FETCH_CONCURRENCY, async (id) => {
    if (byId.has(id)) return;
    const resolved = await resolveUser(guild, id);
    if (!resolved) return;
    byId.set(id, { id, displayName: resolved.displayName, user: resolved.user });
  });

  const voters: VoterUser[] = [];
  const seen = new Set<string>();
  for (const id of voterIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const v = byId.get(id);
    if (v) voters.push(v);
  }

  return { voters };
}
