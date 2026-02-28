import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { config } from "../../config.js";
import { EMOJI_CONFIRM, EMOJI_FAIL, EMOJI_REPORT } from "../../config/constants.js";
import { deletePendingMatch, getMatch } from "../../services/reporting.service.js";
import { getPlayerListMessage } from "../../utils/convert-match-to-str.js";
import { deleteLater, safeDelete } from "../../utils/discord-safe.js";
import { errorMessage } from "../../utils/error-message.js";

export const data = new SlashCommandBuilder()
  .setName("remove-match")
  .setDescription("Removes a match report from the database.")
  .addStringOption(option =>
    option.setName("match-id")
      .setDescription("ID of the match to remove")
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

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  try {
    await interaction.editReply(`Deleting report...`).catch(() => undefined);
    const getMatchRes = await getMatch(matchId);
    if (!interaction.inCachedGuild()) throw new Error('Not a cached guild');
    if (getMatchRes?.reporter_discord_id != interaction.user.id &&
        !interaction.member.roles.cache.has(config.discord.roles.moderator)) {
      console.log(`User trying to delete match: ${interaction.user.id}. Original reporter id ${getMatchRes?.reporter_discord_id}`);
      await interaction.editReply(`${EMOJI_FAIL} Only original reporter <@${getMatchRes?.reporter_discord_id}> or a moderator can delete a report`);
      return;
    }
    const header =
      `${EMOJI_REPORT} Removing match by <@${interaction.user.id}>\n` +
      `Match ID: **${matchId}**\n`;
    const playerListMessage = getPlayerListMessage(getMatchRes);
    const changingOrderMsg = header + playerListMessage;
    const interactionReply = await interaction.followUp({ content: changingOrderMsg });

    const res = await deletePendingMatch(matchId);

    const successMsg = `${EMOJI_CONFIRM} Match **${matchId}** removed successfully!\n` + playerListMessage;
    await interactionReply.edit(successMsg).catch(() => undefined);
    deleteLater(interactionReply, 10 * 60 * 1000);

    await interaction.deleteReply().catch(() => undefined);

    if (interaction.channel?.isTextBased()) {
      for (const id of res.discord_messages_id_list ?? []) {
        const message = await interaction.channel.messages.fetch(id).catch(() => null);
        if (message) await safeDelete(message);
      }
    }

  } catch (err: unknown) {
    const msg = await interaction.editReply(`${EMOJI_FAIL} Remove match failed: ${errorMessage(err)}`).catch(() => null);
    if (msg) deleteLater(msg, 60_000);
  }
}