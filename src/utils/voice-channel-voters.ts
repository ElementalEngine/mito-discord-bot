import type { Guild, GuildMember, VoiceBasedChannel } from 'discord.js';
import type { BuildVoiceChannelVotersResult, VoterUser } from './types.js';

const SNOWFLAKE_RE = /^\d{17,20}$/;
const MENTION_RE = /<@!?(\d{17,20})>/g;

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

  for (const id of addIds) {
    if (byId.has(id)) continue;
    const resolved = await resolveUser(guild, id);
    if (!resolved) continue;
    byId.set(id, { id, displayName: resolved.displayName, user: resolved.user });
  }

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
