import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { ApiClient } from '../../api/index.js';
import { config } from '../../config.js';
import type { CivEdition } from '../../config/types.js';
import { viewOf } from '../../services/report.service.js';
import { duplicateText, isAssigned, reportPanel } from '../../ui/panels/report.js';
import { defer, fail, refuse, respond, say } from '../../ui/reply.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';
import { logAction } from '../../utils/log-command.js';
import { downloadAttachment, validateSaveAttachment } from '../../utils/save-attachment.js';

const api = new ApiClient();
const uploads = config.discord.channels;

const ACCESS_POLICY = {
  allowedChannelIds: [
    uploads.civ6realtimeUploads,
    uploads.civ7realtimeUploads,
    uploads.civ6cloudUploads,
    uploads.civ7cloudUploads,
  ],
} as const;

export const data = new SlashCommandBuilder()
  .setContexts(InteractionContextType.Guild)
  .setName('report-game')
  .setDescription('Validate the channel & save, then upload to the reporter backend.')
  .addAttachmentOption((option) =>
    option.setName('game-save').setDescription('Upload the .Civ6Save or .Civ7Save file (\u226412MB)').setRequired(true),
  );

// The channel decides the edition and the mode. The report is the deferred
// reply itself, so its message id is known before the upload is stored.
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await ensureCommandAccess(interaction, ACCESS_POLICY))) return;
  const save = interaction.options.getAttachment('game-save', true);
  const civ6 = interaction.channelId === uploads.civ6realtimeUploads || interaction.channelId === uploads.civ6cloudUploads;
  const cloud = interaction.channelId === uploads.civ6cloudUploads || interaction.channelId === uploads.civ7cloudUploads;
  const edition: CivEdition = civ6 ? 'CIV6' : 'CIV7';
  try {
    try {
      validateSaveAttachment(save, edition);
    } catch (error) {
      refuse(error instanceof Error ? error.message : 'That file is not a save.');
    }
    await defer(interaction, 'public');
    const reply = await interaction.fetchReply();
    const file = await downloadAttachment(save.url);
    const upload = await api.uploadMatch(file, save.name, interaction.user.id, cloud, reply.id);
    if (upload.repeated) {
      await say(interaction, 'refused', duplicateText(upload));
      return;
    }
    await respond(interaction, reportPanel(await viewOf(upload, api)), 'public');
    const unassigned = upload.players.filter((p) => !isAssigned(p)).map((p) => p.user_name ?? 'unknown');
    await logAction(interaction, 'report-game', { matchId: upload.match_id, edition, unassigned });
  } catch (error) {
    await fail(interaction, error, 'report the game');
  }
}
