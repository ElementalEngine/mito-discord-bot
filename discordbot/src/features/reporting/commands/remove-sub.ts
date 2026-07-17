import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { config } from "../../../core/config/index.js";
import { EMOJI_CONFIRM, EMOJI_FAIL, MAX_DISCORD_LEN } from "../../../core/config/constants.js";
import { getMatch, removeSub } from "../service.js";
import { buildReportEmbed } from "../ui/reporting.embed.js";
import { convertMatchToStr } from "../format.js";
import { chunkByLength } from "../chunk-by-length.js";
import { deleteLater } from "../../../core/discord/index.js";
import { errorMessage } from "../../../core/errors.js";
import { logCommand } from "../../../core/discord/index.js";

import type { BaseReport } from "../types.js";

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
  await logCommand(interaction, 
    config.discord.channels.reportLogChannel,
    data.name,
    {
      matchId: matchId,
      subOutId: subOutId,
    }
  );

  await interaction.deferReply();

  try {
    const getMatchRes = await getMatch(matchId);
    if (!interaction.inCachedGuild()) throw new Error('Not a cached guild');
    if (getMatchRes?.reporter_discord_id != interaction.user.id &&
        !interaction.member.roles.cache.has(config.discord.roles.moderator)) {
      const msg = await interaction.editReply(`${EMOJI_FAIL} Only original reporter <@${getMatchRes?.reporter_discord_id}> or a moderator can assign subs`).catch(() => null);
      if (msg) deleteLater(msg, 60_000);
      return;
    }
    const subOutPlayerIndex = parseInt(subOutId) - 1;
    if ((subOutPlayerIndex < 0) || (subOutPlayerIndex >= (getMatchRes?.players.length ?? 0)) || (getMatchRes?.players[subOutPlayerIndex].subbed_out === false)) {
      const msg = await interaction.editReply(`${EMOJI_FAIL} Invalid sub out player ID ${subOutId} for match ${matchId} or player is not marked as subbed out`).catch(() => null);
      if (msg) deleteLater(msg, 60_000);
      return;
    }
    const subOutPlayer = getMatchRes?.players[subOutPlayerIndex];
    const subOutDiscordID = subOutPlayer?.discord_id;
    if (!subOutDiscordID) {
      const msg = await interaction.editReply(`${EMOJI_FAIL} Sub-out player is missing a Discord ID.`).catch(() => null);
      if (msg) deleteLater(msg, 60_000);
      return;
    }
    const removeSubMsg = await interaction.editReply(`Removing substitute player <@${subOutDiscordID}>`);
    const res = await removeSub(matchId, subOutPlayerIndex.toString(), removeSubMsg.id);

    const updatedEmbed = buildReportEmbed(res, {
      reporterId: interaction.user.id,
    });
    const embedMsgId = (res as BaseReport).discord_messages_id_list[0];
    if (embedMsgId && interaction.channel?.isTextBased()) {
      const message = await interaction.channel.messages.fetch(embedMsgId).catch(() => null);
      if (message) await message.edit({ embeds: [updatedEmbed] }).catch(() => undefined);
    }

    const header =
      `${EMOJI_CONFIRM} Substitute <@${subOutDiscordID}> removed by <@${interaction.user.id}>\n` +
      `Match ID: **${res.match_id}**\n`;

    const full = header + convertMatchToStr(res as BaseReport, false);
    const chunks = Array.from(chunkByLength(full, MAX_DISCORD_LEN));
    const first = chunks[0] ?? header;
    await removeSubMsg.edit(first);
    for (const chunk of chunks.slice(1)) {
      await interaction.followUp({ content: chunk }).catch(() => undefined);
    }
  } catch (err: unknown) {
    const msg = await interaction.editReply(`${EMOJI_FAIL} Remove sub failed: ${errorMessage(err)}`).catch(() => null);
    if (msg) deleteLater(msg, 60_000);
  }
}