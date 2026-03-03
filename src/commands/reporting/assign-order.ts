import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { config } from "../../config.js";
import { EMOJI_CONFIRM, EMOJI_FAIL, EMOJI_REPORT } from "../../config/constants.js";
import { setPlayerOrder, getMatch } from "../../services/reporting.service.js";
import { buildReportEmbed } from "../../ui/layouts/report.layout.js";
import { allPlayersHaveDiscordId, normalizePlayerList, isValidPlayerList } from "../../utils/convert-match-to-str.js";
import { deleteLater, safeDelete } from "../../utils/discord-safe.js";
import { errorMessage } from "../../utils/error-message.js";

import type { BaseReport } from "../../types/reports.js";

export const data = new SlashCommandBuilder()
  .setName("assign-order")
  .setDescription("Assign the order of players in a game.")
  .addStringOption(option =>
    option.setName("match-id")
      .setDescription("ID of the match to change the order for")
      .setRequired(true),
  )
  .addStringOption(option =>
    option.setName("player-order")
      .setDescription("List of player IDs in the order they should be in, separated by space. e.g. @Adam @Bob")
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

  const matchId = interaction.options.getString("match-id", true) as string;
  const playerOrder = interaction.options.getString("player-order", true) as string;

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });
  let interactionReply: Awaited<ReturnType<typeof interaction.followUp>> | null = null;

  try {
    await interaction.editReply(`Processing assign order request...`);
    const getMatchRes = await getMatch(matchId);
    if (!interaction.inCachedGuild()) throw new Error('Not a cached guild');
    const isModerator = interaction.member.roles.cache.has(config.discord.roles.moderator);
    if (getMatchRes?.reporter_discord_id != interaction.user.id && !isModerator) {
      await interaction.editReply(`${EMOJI_FAIL} Only original reporter <@${getMatchRes?.reporter_discord_id}> or a moderator can use the assign order command`);
      return;
    }
    console.log('gameMode', getMatchRes?.game_mode);
    if (getMatchRes?.game_mode === "teamer") {
      await interaction.editReply(`${EMOJI_FAIL} This command is not available for teamer games. Use /assign-order-teamer instead.`);
      return;
    }
    if (!allPlayersHaveDiscordId(getMatchRes.players)) {
      await interaction.editReply(`${EMOJI_FAIL} Cannot assign order for a report with players that do not have Discord IDs. Please contact a CPL staff to assign the missing discord id.`);
      return;
    }
    const normalizedPlayerOrder = normalizePlayerList(playerOrder);
    const hasTie = normalizedPlayerOrder.split(/\s+/).includes('TIE');
    if (!isModerator && hasTie) {
      const msg = await interaction.editReply(`${EMOJI_FAIL} You do not have permission to set tie positions.`).catch(() => null);
      if (msg) deleteLater(msg, 60_000);
      return;
    }
    if (isValidPlayerList(normalizedPlayerOrder, getMatchRes.players) === false) {
      const msg = await interaction.editReply(`${EMOJI_FAIL} The player list provided is invalid.`).catch(() => null);
      if (msg) deleteLater(msg, 60_000);
      return;
    }
    const playerOrderWithMentions = playerOrder.split(" ").map(p => p.toLowerCase() === "tie" ? p : `<@${p.replace(/<@/g, '').replace(/>/g, '')}>`).join(" ");
    const changingOrderMsg =
      `${EMOJI_REPORT} Processing assign order to ${playerOrderWithMentions} by <@${interaction.user.id}>\n` +
      `Match ID: **${matchId}**\n`;
    interactionReply = await interaction.followUp({ content: changingOrderMsg });
    const changingOrderMsgId = interactionReply.id;

    const res = await setPlayerOrder(matchId, normalizedPlayerOrder, changingOrderMsgId);

    const confirmMsg =
      `${EMOJI_CONFIRM} Match order changed to ${playerOrderWithMentions} by <@${interaction.user.id}>\n` +
      `Match ID: **${matchId}**\n`;
    await interactionReply.edit(confirmMsg);

    const updatedEmbed = buildReportEmbed(res, {
      reporterId: interaction.user.id,
    });
    const embedMsgId = (res as BaseReport).discord_messages_id_list[0];
    if (embedMsgId && interaction.channel?.isTextBased()) {
      const message = await interaction.channel.messages.fetch(embedMsgId).catch(() => null);
      if (message) await message.edit({ embeds: [updatedEmbed] }).catch(() => undefined);
    }
    await interaction.editReply({ content: `${EMOJI_CONFIRM} Change report order successful!` });

  } catch (err: unknown) {
    if (interactionReply) await safeDelete(interactionReply);
    const msg = await interaction.editReply(`${EMOJI_FAIL} Change report order failed: ${errorMessage(err)}`).catch(() => null);
    if (msg) deleteLater(msg, 60_000);
  }
}