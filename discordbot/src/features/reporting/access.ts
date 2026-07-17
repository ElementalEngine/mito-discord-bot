import type { ChatInputCommandInteraction } from "discord.js";

/**
 * True if the interaction's member has the given role. Handles both
 * APIInteractionGuildMember (roles is string[]) and the gateway GuildMember
 * (roles.cache). Slice-local: reporting is the only consumer today; promote to
 * core/discord only if a second slice needs it (architecture ≥2-consumer rule).
 */
export function memberHasRole(interaction: ChatInputCommandInteraction, roleId: string): boolean {
  const member = interaction.member;
  if (!member || typeof member !== "object") return false;

  // APIInteractionGuildMember: roles is string[]
  if ("roles" in member && Array.isArray((member as { roles: unknown }).roles)) {
    return (member as { roles: string[] }).roles.includes(roleId);
  }

  if ("roles" in member) {
    const roles = (member as { roles: unknown }).roles;
    if (roles && typeof roles === "object" && "cache" in roles) {
      const cache = (roles as { cache: { has: (id: string) => boolean } }).cache;
      return cache.has(roleId);
    }
  }

  return false;
}