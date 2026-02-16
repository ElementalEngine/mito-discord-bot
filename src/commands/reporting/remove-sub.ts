import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { config } from "../../config.js";
import { EMOJI_CONFIRM, EMOJI_FAIL, MAX_DISCORD_LEN } from "../../config/constants.js";
import { getMatch, removeSub } from "../../services/reporting.service.js";
import { buildReportEmbed } from "../../ui/report.layout.js";
import { convertMatchToStr } from "../../utils/convert-match-to-str.js";

import type { BaseReport } from "../../types/reports.js";

export const data = new SlashCommandBuilder()
  .setName("remove-sub")
  .setDescription("Remove a substitute.")
  .addStringOption(option =>
    option.setName("match-id")
      .setDescription("ID of the match to remove substitute from")
      .setRequired(true),
  )
  .addStringOption(option =>
    option.setName("sub-out-slot-id")
      .setDescription("Slot ID of the player in this match to remove")
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
  const subOutId = interaction.options.getString("sub-out-slot-id", true) as string;

  const errors: string[] = [];

  if (errors.length) {
    await interaction.reply({
      content: `${EMOJI_FAIL} FAIL\n${errors.map(e => `• ${e}`).join("\n")}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferReply();

  try {
    const getMatchRes = await getMatch(matchId);
    if (!interaction.inCachedGuild()) throw new Error('Not a cached guild');
    if (getMatchRes?.reporter_discord_id != interaction.user.id &&
        !interaction.member.roles.cache.has(config.discord.roles.moderator)) {
      await interaction.editReply(`${EMOJI_FAIL} Only original reporter <@${getMatchRes?.reporter_discord_id}> or a moderator can assign subs`)
        .then(repliedMessage => {
          setTimeout(() => repliedMessage.delete(), 60 * 1000);
        })
        .catch();
      return;
    }
    const subOutPlayerIndex = parseInt(subOutId) - 1;
    if ((subOutPlayerIndex < 0) || (subOutPlayerIndex >= (getMatchRes?.players.length ?? 0)) || (getMatchRes?.players[subOutPlayerIndex].subbed_out === false)) {
      await interaction.editReply(`${EMOJI_FAIL} Invalid sub out player ID ${subOutId} for match ${matchId} or player is not marked as subbed out`)
        .then(repliedMessage => {
          setTimeout(() => repliedMessage.delete(), 60 * 1000);
        })
        .catch();
      return;
    }
    const subOutPlayer = getMatchRes?.players[subOutPlayerIndex];
    const subOutDiscordID = subOutPlayer?.discord_id;
    const removeSubMsg = await interaction.editReply(`Removing substitute player <@${subOutDiscordID}>`);
    const res = await removeSub(matchId, subOutPlayerIndex.toString(), removeSubMsg.id);

    const updatedEmbed = buildReportEmbed(res, {
      reporterId: interaction.user.id,
    });
    const embedMsgId = (res as BaseReport).discord_messages_id_list[0];
    const message = await interaction.channel?.messages.fetch(embedMsgId);
    if (message) {
      await message.edit({ embeds: [updatedEmbed] });
    }

    const header =
      `${EMOJI_CONFIRM} Substitute <@${subOutDiscordID}> removed by <@${interaction.user.id}>` +
      `Match ID: **${res.match_id}**\n`;

    const full = header + convertMatchToStr(res as BaseReport, false);
    removeSubMsg.edit(full);
  } catch (err: any) {
    const msg = err?.body ? `${err.message}: ${JSON.stringify(err.body)}` : (err?.message ?? "Unknown error");
    await interaction.editReply(`${EMOJI_FAIL} Discord ID assignment failed: ${msg}`)
      .then(repliedMessage => {
          setTimeout(() => repliedMessage.delete(), 60 * 1000);
        })
      .catch();
  }
}