import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { ApiClient } from '../../api/index.js';
import { config } from '../../config.js';
import type { CivEdition } from '../../config/types.js';
import { inTurn, refreshReport, viewOf } from '../../services/report.service.js';
import { notice } from '../../ui/kit/index.js';
import { duplicateText, isAssigned, playerIds, reportPanel, seatsOf } from '../../ui/panels/report.js';
import { defer, fail, refuse, respond, say } from '../../ui/reply.js';
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
// reply itself, so its message id is known before the upload is stored.
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await ensureCommandAccess(interaction, ACCESS_POLICY))) return;
  // A thread passes the access check through its parent, but the report must
  // live where it is found again: the uploads channel itself.
  if (!ACCESS_POLICY.allowedChannelIds.some((id) => id === interaction.channelId)) {
    await say(interaction, 'refused', 'Run /report-game in the uploads channel itself, not in a thread.');
    return;
  }
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
    // The save downloads while Discord takes the deferral, so neither waits on the other.
    const download = downloadAttachment(save.url);
    download.catch(() => undefined);
    await defer(interaction, 'public');
    const [reply, file] = await Promise.all([interaction.fetchReply(), download]);
    const upload = await api.uploadMatch(file, save.name, interaction.user.id, cloud, reply.id);
    if (upload.repeated) {
      // A pending report is drawn again where it stands, so one whose first
      // showing was lost gets its buttons back. It is read afresh in its turn.
      if (!upload.approved_at) {
        await inTurn(upload.match_id, async () => {
          const match = await api.match(upload.match_id);
          if (!match.approved_at) await refreshReport(interaction.client, match, reportPanel(await viewOf(match, api)));
        }).catch((error: unknown) => {
          log.warn('report not redrawn', upload.match_id, error instanceof Error ? error.message : error);
        });
      }
      await say(interaction, 'refused', duplicateText(upload));
      return;
    }
    try {
      // The report pings its players, as the approved result does.
      await respond(interaction, reportPanel(await viewOf(upload, api)), 'public', {
        allowedMentions: { users: playerIds(upload) },
      });
    } catch (error) {
      // Stored already: keep this message, which is the report's, and say so.
      log.warn('report not shown', upload.match_id, error instanceof Error ? error.message : error);
      const lost = 'The game is stored, but its report could not be shown. Run /report-game again with the same save to bring it back.';
      await respond(interaction, notice('failed', lost), 'public').catch(() => undefined);
      return;
    }
    const unassigned = seatsOf(upload).filter((s) => !isAssigned(s.player)).map((s) => s.player.user_name ?? 'unknown');
    await logAction(interaction, 'report-game', { matchId: upload.match_id, edition, unassigned });
  } catch (error) {
    await fail(interaction, error, 'report the game');
  }
}
