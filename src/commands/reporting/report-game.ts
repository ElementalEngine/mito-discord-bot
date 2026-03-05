import {
  EmbedBuilder,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
} from "discord.js";
import { config } from "../../config.js";
import { validateSaveAttachment } from "../../utils/save-attachment.js";
import {
  EMOJI_CONFIRM,
  EMOJI_FAIL,
  EMOJI_REPORT,
  MAX_DISCORD_LEN,
} from "../../config/constants.js";
import type { CivEdition } from "../../types/data.js";
import {
  submitSaveForReport,
  appendMessageIdList,
} from "../../services/reporting.service.js";
import { buildReportEmbed } from "../../ui/layouts/report.layout.js";
import { chunkByLength } from "../../utils/chunk-by-length.js";
import { convertMatchToStr } from "../../utils/convert-match-to-str.js";
import { ensureCommandAccess } from "../../utils/ensure-command-access.js";
import { deleteLater } from "../../utils/discord-safe.js";
import { errorMessage } from "../../utils/error-message.js";

import type { BaseReport } from "../../types/reports.js";
import type { UploadSaveResponse } from "../../api/types.js";

const ACCESS_POLICY = {
  allowedChannelIds: [
    config.discord.channels.civ6realtimeUploads,
    config.discord.channels.civ7realtimeUploads,
    config.discord.channels.civ6cloudUploads,
    config.discord.channels.civ7cloudUploads,
  ],
} as const;

export const data = new SlashCommandBuilder()
  .setName("report-game")
  .setDescription("Validate the channel & save, then upload to the reporter backend.")
  .addAttachmentOption((option) =>
    option
      .setName("game-save")
      .setDescription("Upload the .Civ6Save or .Civ7Save file (≤12MB)")
      .setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!(await ensureCommandAccess(interaction, ACCESS_POLICY))) return;

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply();
  }

  const save = interaction.options.getAttachment("game-save", true);

  const civ6realtimeChannelId = config.discord.channels.civ6realtimeUploads;
  const civ7realtimeChannelId = config.discord.channels.civ7realtimeUploads;
  const civ6cloudChannelId = config.discord.channels.civ6cloudUploads;

  const edition: CivEdition =
    interaction.channelId === civ6realtimeChannelId ||
    interaction.channelId === civ6cloudChannelId
      ? "CIV6"
      : "CIV7";

  const mode =
    interaction.channelId === civ6realtimeChannelId ||
    interaction.channelId === civ7realtimeChannelId
      ? "realtime"
      : "cloud";

  const errors: string[] = [];
  try {
    validateSaveAttachment(save, edition);
  } catch (e: unknown) {
    errors.push(errorMessage(e) || "Invalid save attachment.");
  }

  if (errors.length > 0) {
    const msg = await interaction
      .editReply({
        content: `${EMOJI_FAIL} FAIL\n${errors.map((e) => `• ${e}`).join("\n")}`,
      })
      .catch(() => null);
    if (msg) deleteLater(msg, 60_000);
    return;
  }

  try {
    const pendingEmbed = new EmbedBuilder().setDescription(
      `${EMOJI_REPORT} Uploading and processing your save file, please wait...`,
    );

    const pendingMsg = await interaction.editReply({ embeds: [pendingEmbed] });

    const res: UploadSaveResponse = await submitSaveForReport(
      save.url,
      save.name ?? (edition === "CIV6" ? "game.Civ6Save" : "game.Civ7Save"),
      interaction.user.id,
      mode === "cloud",
      pendingMsg.id,
    );

    if (res?.repeated === true) {
      const duplicateReportEmbed = new EmbedBuilder().setDescription(
        `${EMOJI_FAIL} Match already reported! Match ID: **${res.match_id}**`,
      );

      const msg = await pendingMsg
        .edit({ embeds: [duplicateReportEmbed] })
        .catch(() => null);
      if (msg) deleteLater(msg, 60_000);
      return;
    }

    const embed = buildReportEmbed(res, { reporterId: interaction.user.id });
    await interaction.editReply({ embeds: [embed] });

    const header =
      `${EMOJI_CONFIRM} Match reported by <@${interaction.user.id}>\n` +
      `Match ID: **${res.match_id}**\n`;

    const full = header + convertMatchToStr(res as BaseReport, true);

    const messageIdsList: string[] = [];
    for (const chunk of chunkByLength(full, MAX_DISCORD_LEN)) {
      const followUp = await interaction.followUp({ content: chunk });
      messageIdsList.push(followUp.id);
    }

    const appendRes: UploadSaveResponse = await appendMessageIdList(
      res.match_id,
      messageIdsList,
    );

    if (!appendRes) {
      console.error("Failed to append message ID list for match:", res.match_id);
    }
  } catch (err: unknown) {
    const msg = await interaction
      .editReply(`${EMOJI_FAIL} Upload failed: ${errorMessage(err)}`)
      .catch(() => null);
    if (msg) deleteLater(msg, 60_000);
  }
}
