import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { memberHasRole } from "../access.js";
import { error as logError, warn as logWarn } from "../../../core/logging.js";
import type { ChatInputCommandInteraction } from "discord.js";

import { config } from "../../../core/config/index.js";
import { EMOJI_CONFIRM, EMOJI_FAIL, MAX_DISCORD_LEN } from "../../../core/config/constants.js";
import { assignDiscordId } from "../service.js";
import { buildReportEmbed } from "../ui/reporting.embed.js";
import { chunkByLength } from "../chunk-by-length.js";
import { convertMatchToStr } from "../format.js";
import type { BaseReport } from "../types.js";
import { parseDiscordUserId } from "../parse-discord-id.js";
import { deleteLater } from "../../../core/discord/index.js";
import { errorMessage } from "../../../core/errors.js";
import { logCommand } from "../../../core/discord/index.js";


async function safeDefer(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (interaction.deferred || interaction.replied) return true;
  try {
    await interaction.deferReply(); // keep non-ephemeral behavior
    return true;
  } catch (e: unknown) {
    logError("/assign-discord-id deferReply failed:", e);
    return false;
  }
}

export const data = new SlashCommandBuilder()
  .setName("assign-discord-id")
  .setDescription("Set a player's discord id.")
  .addStringOption((option) =>
    option
      .setName("match-id")
      .setDescription("ID of the match to change discord id of a player")
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("player-slot-id")
      .setDescription("Slot ID of the player in this match to assign")
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("discord-id")
      .setDescription("Discord ID of the player (you may also tag the player)")
      .setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: `${EMOJI_FAIL} This command must be used in a server.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // ✅ ack immediately to avoid 10062
  if (!(await safeDefer(interaction))) return;

  const matchId = interaction.options.getString("match-id", true);
  const playerId = interaction.options.getString("player-slot-id", true);
  const rawDiscordId = interaction.options.getString("discord-id", true);
  const playerDiscordId = parseDiscordUserId(rawDiscordId);

  await logCommand(interaction, 
    config.discord.channels.reportLogChannel,
    data.name,
    {
      matchId: matchId,
      playerId: playerId,
      playerDiscordId: playerDiscordId,
    }
  );

  if (!playerDiscordId) {
    const msg = await interaction.editReply(
      `${EMOJI_FAIL} Invalid Discord ID. Use a numeric ID or tag the user (e.g. <@123...>).`,
    );
    deleteLater(msg, 60_000);
    return;
  }

  const isCloudChannel =
    interaction.channelId === config.discord.channels.civ6cloudUploads ||
    interaction.channelId === config.discord.channels.civ7cloudUploads;

  const isModerator = memberHasRole(interaction, config.discord.roles.moderator);

  // preserve existing policy: moderators anywhere, otherwise only in cloud channels
  if (!isModerator && !isCloudChannel) {
    const msg = await interaction.editReply(
      `${EMOJI_FAIL} Only a moderator can assign a player discord id.`,
    );
    deleteLater(msg, 60_000);
    return;
  }

  try {
    const statusMsg = await interaction.editReply(
      `Processing assign discord id request for <@${playerDiscordId}>...`,
    );

    const res = await assignDiscordId(matchId, playerId, playerDiscordId, statusMsg.id);
    const report = res as BaseReport;
    const embedMsgId = report.discord_messages_id_list?.[0];
    if (embedMsgId && interaction.channel?.isTextBased()) {
      const updatedEmbed = buildReportEmbed(res, { reporterId: interaction.user.id });
      const msg = await interaction.channel.messages.fetch(embedMsgId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [updatedEmbed] }).catch((e: unknown) => {
          logWarn("Failed to edit report embed message:", e);
        });
      }
    }

    const header =
      `${EMOJI_CONFIRM} <@${playerDiscordId}>\nDiscord ID assigned by <@${interaction.user.id}>\n` +
      `Match ID: **${report.match_id}**\n`;

    const full = header + convertMatchToStr(report, false);
    const chunks = Array.from(chunkByLength(full, MAX_DISCORD_LEN));
    const first = chunks[0] ?? header;

    await statusMsg.edit(first);

    for (const chunk of chunks.slice(1)) {
      await interaction.followUp({ content: chunk }).catch(() => {});
    }
  } catch (err: unknown) {
    const msg = await interaction.editReply(
      `${EMOJI_FAIL} Discord ID assignment failed: ${errorMessage(err)}`,
    );
    deleteLater(msg, 60_000);
  }
}
