import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { config } from "../../config.js";
import { EMOJI_CONFIRM, EMOJI_FAIL, EMOJI_REPORT } from "../../config/constants.js";
import { setPlacements, getMatch } from "../../services/reporting.service.js";
import { buildReportEmbed } from "../../ui/embeds/reporting.js";
import { getPlayerListMessage, isValidOrder } from "../../utils/convert-match-to-str.js";
import { deleteLater, safeDelete } from "../../utils/discord-safe.js";
import { errorMessage } from "../../utils/error-message.js";

import type { BaseReport } from "../../types/reporting.types.js";

export const data = new SlashCommandBuilder()
  .setName("assign-order-teamer")
  .setDescription("Assign the order of teams in a teamer game.")
  .addStringOption(option =>
    option.setName("match-id")
      .setDescription("ID of the match to change the order for")
      .setRequired(true),
  )
  .addStringOption(option =>
    option.setName("new-order")
      .setDescription("Placement of each team e.g. 4 2 1 3 means 1st team is 4th place, 2nd team is 2nd place, etc.")
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
  const newOrder = interaction.options.getString("new-order", true) as string;

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
      await interaction.editReply(`${EMOJI_FAIL} Only original reporter <@${getMatchRes?.reporter_discord_id}> or a moderator can use this command.`);
      return;
    }
    if (getMatchRes?.game_mode !== "teamer") {
      await interaction.editReply(`${EMOJI_FAIL} This command is not available for FFA/duel games. Use /assign-order instead.`);
      return;
    }

    const tokens = newOrder.trim().split(/\s+/).filter(Boolean);
    const hasDuplicate = new Set(tokens).size !== tokens.length;
    if (!isModerator && hasDuplicate) {
      const msg = await interaction.editReply(`${EMOJI_FAIL} You do not have permission to set tie positions.`).catch(() => null);
      if (msg) deleteLater(msg, 60_000);
      return;
    }
    if (isValidOrder(newOrder, getMatchRes.players) === false) {
      const msg = await interaction.editReply(`${EMOJI_FAIL} The new order provided is invalid.`).catch(() => null);
      if (msg) deleteLater(msg, 60_000);
      return;
    }
    const header =
      `${EMOJI_REPORT} Processing assign order request to ${newOrder} by <@${interaction.user.id}>\n` +
      `Match ID: **${matchId}**\n`;
    const playerListMessage = `Players: ` + getPlayerListMessage(getMatchRes, newOrder);
    const changingOrderMsg = header + playerListMessage;
    interactionReply = await interaction.followUp({ content: changingOrderMsg });
    const changingOrderMsgId = interactionReply.id;
    const res = await setPlacements(matchId, newOrder, changingOrderMsgId);

    const confirmMsg =
      `${EMOJI_CONFIRM} Match order assigned to ${newOrder} by <@${interaction.user.id}>\n` +
      `Match ID: **${matchId}**\n` + playerListMessage;
    await interactionReply.edit(confirmMsg);

    const updatedEmbed = buildReportEmbed(res, {
      reporterId: interaction.user.id,
    });
    const embedMsgId = (res as BaseReport).discord_messages_id_list[0];
    if (embedMsgId && interaction.channel?.isTextBased()) {
      const message = await interaction.channel.messages.fetch(embedMsgId).catch(() => null);
      if (message) await message.edit({ embeds: [updatedEmbed] }).catch(() => undefined);
    }
    await interaction.editReply({ content: `${EMOJI_CONFIRM} Assign report order successful!` });

  } catch (err: unknown) {
    if (interactionReply) await safeDelete(interactionReply);
    const msg = await interaction.editReply(`${EMOJI_FAIL} Assign report order failed: ${errorMessage(err)}`).catch(() => null);
    if (msg) deleteLater(msg, 60_000);
  }
}