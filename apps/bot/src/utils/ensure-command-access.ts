import type { ChatInputCommandInteraction } from 'discord.js';

import { config } from '../config.js';
import { say } from '../ui/reply.js';
import type { CommandAccessPolicy } from './types.js';


const SNOWFLAKE_RE = /^\d{17,20}$/;

function uniqSnowflakes(ids: readonly (string | null | undefined)[]): string[] {
  const set = new Set<string>();
  for (const raw of ids) {
    const id = raw?.trim();
    if (id && SNOWFLAKE_RE.test(id)) set.add(id);
  }
  return [...set];
}

function getEffectiveChannelId(interaction: ChatInputCommandInteraction): string {
  const ch = interaction.channel;
  if (ch?.isThread?.()) return ch.parentId ?? interaction.channelId;
  return interaction.channelId;
}

function getMemberRoleIds(
  interaction: ChatInputCommandInteraction
): Set<string> | null {
  if (!interaction.inGuild()) return null;

  if (interaction.inCachedGuild()) {
    return new Set(interaction.member.roles.cache.keys());
  }

  const m = interaction.member;
  if (m && typeof m === 'object' && 'roles' in m) {
    const roles = (m as { roles?: unknown }).roles;
    if (Array.isArray(roles) && roles.every((r) => typeof r === 'string')) {
      return new Set(roles);
    }
  }
  return null;
}

function mentionChannels(ids: readonly string[]): string {
  return ids.map((id) => `<#${id}>`).join(', ');
}

function mentionRoles(ids: readonly string[]): string {
  return ids.map((id) => `<@&${id}>`).join(', ');
}

export async function ensureCommandAccess(
  interaction: ChatInputCommandInteraction,
  policy: CommandAccessPolicy
): Promise<boolean> {
  if (!interaction.inGuild()) {
    await say(
      interaction,
      'refused',
      `This command must be used in a server.`
    );
    return false;
  }

  const allowedChannels = uniqSnowflakes(policy.allowedChannelIds);
  if (allowedChannels.length === 0) {
    await say(
      interaction,
      'failed',
      `Command access is not configured (no valid allowed channels).`
    );
    return false;
  }

  const channelId = getEffectiveChannelId(interaction);
  if (!allowedChannels.includes(channelId)) {
    await say(
      interaction,
      'refused',
      `Use this command in: ${mentionChannels(allowedChannels)}`
    );
    return false;
  }

  if (policy.requiredRoleIds === undefined) return true;

  const requiredRoles = uniqSnowflakes(policy.requiredRoleIds);
  if (requiredRoles.length === 0) {
    await say(
      interaction,
      'failed',
      `Command access is not configured (no valid required roles).`
    );
    return false;
  }

  const roleIds = getMemberRoleIds(interaction);
  if (!roleIds) {
    await say(
      interaction,
      'failed',
      `Unable to verify your roles. Try again.`
    );
    return false;
  }

  const moderatorId =
    policy.allowModeratorOverride === false ? '' : (config.discord.roles.moderator?.trim() ?? '');
  if (moderatorId && roleIds.has(moderatorId)) return true;

  const developerId = policy.allowDeveloperOverride
    ? (config.discord.roles.developer?.trim() ?? '')
    : '';
  if (developerId && roleIds.has(developerId)) return true;

  if (requiredRoles.some((id) => roleIds.has(id))) return true;

  const displayed = uniqSnowflakes(
    [moderatorId, developerId, ...requiredRoles].filter(Boolean)
  );
  await say(
      interaction,
      'refused',
      `Missing required role. Need one of: ${mentionRoles(displayed)}`
  );
  return false;
}
