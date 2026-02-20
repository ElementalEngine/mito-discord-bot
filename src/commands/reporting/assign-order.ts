import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { config } from "../../config.js";
import { EMOJI_CONFIRM, EMOJI_FAIL, EMOJI_REPORT } from "../../config/constants.js";
import { setPlayerOrder, getMatch } from "../../services/reporting.service.js";
import { buildReportEmbed } from "../../ui/report.layout.js";
import { allPlayersHaveDiscordId, normalizePlayerList, isValidPlayerList } from "../../utils/convert-match-to-str.js";

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

  const errors: string[] = [];

  if (errors.length) {
    await interaction.reply({
      content: `${EMOJI_FAIL} FAIL\n${errors.map(e => `• ${e}`).join("\n")}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });
  var interactionReply;

  try {
    await interaction.editReply(`Processing assign order request...`);
    const getMatchRes = await getMatch(matchId);
    if (!interaction.inCachedGuild()) throw new Error('Not a cached guild');
    if (getMatchRes?.reporter_discord_id != interaction.user.id &&
        !interaction.member.roles.cache.has(config.discord.roles.moderator)) {
      await interaction.editReply(`${EMOJI_FAIL} Only original reporter <@${getMatchRes?.reporter_discord_id}> or a moderator can change report order`);
      return;
    }
    if (getMatchRes?.game_mode === "Teamer") {
      await interaction.editReply(`${EMOJI_FAIL} This command is not available for team games.`);
      return;
    }
    if (!allPlayersHaveDiscordId(getMatchRes.players)) {
      await interaction.editReply(`${EMOJI_FAIL} Cannot change order for a report with players that do not have Discord IDs.`);
      return;
    }
    if (!interaction.member.roles.cache.has(config.discord.roles.moderator) && 
        isValidPlayerList(playerOrder, getMatchRes.players) === false) {
      await interaction.editReply(`${EMOJI_FAIL} The player list provided is invalid. Or you do not have permission to set a order with tie positions.`);
      return;
    }
    const playerOrderWithMentions = playerOrder.split(" ").map(p => p.toLowerCase() === "tie" ? p : `<@${p.replace(/<@/g, '').replace(/>/g, '')}>`).join(" ");
    const changingOrderMsg =
      `${EMOJI_REPORT} Processing assign order to ${playerOrderWithMentions} by <@${interaction.user.id}>\n` +
      `Match ID: **${matchId}**\n`;
    interactionReply = await interaction.followUp({ content: changingOrderMsg });
    const changingOrderMsgId = interactionReply.id;

    let normalizedPlayerOrder = normalizePlayerList(playerOrder);

    const res = await setPlayerOrder(matchId, normalizedPlayerOrder, changingOrderMsgId);

    const confirmMsg =
      `${EMOJI_CONFIRM} Match order changed to ${playerOrderWithMentions} by <@${interaction.user.id}>\n` +
      `Match ID: **${matchId}**\n`;
    await interactionReply.edit(confirmMsg);

    const updatedEmbed = buildReportEmbed(res, {
      reporterId: interaction.user.id,
    });
    const embedMsgId = (res as BaseReport).discord_messages_id_list[0];
    const message = await interaction.channel?.messages.fetch(embedMsgId);
    if (message) {
      await message.edit({ embeds: [updatedEmbed] });
    }
    interaction.editReply({ content: `${EMOJI_CONFIRM} Change report order successful!` });

  } catch (err: any) {
    if (interactionReply) {
      interactionReply.delete();
    }
    const msg = err?.body ? `${err.message}: ${JSON.stringify(err.body)}` : (err?.message ?? "Unknown error");
    await interaction.editReply(`${EMOJI_FAIL} Change report order failed: ${msg}`)
      .then(repliedMessage => {
          setTimeout(() => repliedMessage.delete(), 60 * 1000);
        })
      .catch();
  }
}