import { AttachmentBuilder, InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { membersPanel } from '../../ui/panels/misc.js';
import { refuse, respond } from '../../ui/reply.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';

export const data = new SlashCommandBuilder()
  .setContexts(InteractionContextType.Guild)
  .setName('get-users')
  .setDescription('Get information about all users in the server.');

const MAX_FILE_BYTES = 8 * 1024 * 1024;

// Fetching every member is slow on a large server, so the answer is deferred.
export const visibility = 'private';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await ensureCommandAccess(interaction))) return;
  const guild = interaction.guild;
  if (!guild) refuse('Run this in the server, not in a DM.');

  const members = await guild.members.fetch();
  const rows = members.map((member) => ({
    username: member.user.username,
    user_id: member.user.id,
    nickname: member.nickname ?? null,
    display_name: member.displayName,
    join_date: member.joinedAt?.toISOString() ?? null,
    is_bot: member.user.bot,
    roles: member.roles.cache.filter((role) => role.id !== guild.id).map((role) => ({ id: role.id, name: role.name })),
  }));

  const json = Buffer.from(JSON.stringify(rows, null, 2), 'utf-8');
  if (json.length > MAX_FILE_BYTES) {
    refuse(`The export is ${(json.length / 1024 / 1024).toFixed(1)} MB, over the 8 MB upload limit. Ask a developer to export it from the server.`);
  }

  const at = new Date();
  const name = `discord-users-${at.toISOString().replace(/[:.]/g, '-')}.json`;
  const counts = { total: members.size, bots: rows.filter((r) => r.is_bot).length };
  await respond(interaction, membersPanel(counts, name, at), 'private', {
    files: [new AttachmentBuilder(json, { name })],
  });
}
