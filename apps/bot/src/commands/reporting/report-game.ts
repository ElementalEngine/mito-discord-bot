import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { ApiClient } from '../../api/index.js';
import { config } from '../../config.js';
import type { CivEdition } from '../../config/types.js';
import { editorOf, viewOf } from '../../services/report.service.js';
import { duplicateText, isAssigned, reportPanel, seatsOf } from '../../ui/panels/report.js';
import { defer, fail, refuse, respond, say } from '../../ui/reply.js';
import { isStaff } from '../../utils/access.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';
import { log } from '../../utils/log.js';
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
  .setDescription('Report a finished game from its save file.')
  .addAttachmentOption((option) =>
    option.setName('game-save').setDescription('Upload the .Civ6Save or .Civ7Save file (\u226412MB)').setRequired(true),
  );

// The channel decides the edition and the mode. The report is the deferred
// reply itself; a report with seats to fill opens its editor for the reporter.
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
    const unassigned = seatsOf(upload).filter((s) => !isAssigned(s.player)).map((s) => s.player.user_name ?? 'unknown');
    await logAction(interaction, 'report-game', { matchId: upload.match_id, edition, unassigned });
    if (!unassigned.length) return;
    // The report stands either way; the editor is a shortcut to Edit.
    await editorOf(interaction.guild, upload, isStaff(interaction), api)
      .then((editor) => respond(interaction, editor, 'private'))
      .catch((error: unknown) => {
        log.warn('editor not opened after upload', upload.match_id, error instanceof Error ? error.message : error);
      });
  } catch (error) {
    await fail(interaction, error, 'report the game');
  }
}
