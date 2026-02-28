import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { config } from "../../config.js";
import { EMOJI_CONFIRM, EMOJI_FAIL, MAX_DISCORD_LEN } from "../../config/constants.js";
import { getMatch, assignSub } from "../../services/reporting.service.js";
import { buildReportEmbed } from "../../ui/layouts/report.layout.js";
import { convertMatchToStr } from "../../utils/convert-match-to-str.js";
import { chunkByLength } from "../../utils/chunk-by-length.js";
import { parseDiscordUserId } from "../../utils/parse-discord-id.js";
import { deleteLater } from "../../utils/discord-safe.js";
import { errorMessage } from "../../utils/error-message.js";

import type { BaseReport } from "../../types/reports.js";

export const data = new SlashCommandBuilder()
  .setName("assign-sub")
  .setDescription("Assign the sub out for a player.")
  .addStringOption(option =>
    option.setName("match-id")
      .setDescription("ID of the match to assign substitute for a player")
      .setRequired(true),
  )
  .addStringOption(option =>
    option.setName("sub-in-slot-id")
      .setDescription("Slot ID of the player in this match to assign substitute in for")
      .setRequired(true),
  )
  .addStringOption(option =>
    option.setName("sub-out-discord-id")
      .setDescription("Discord ID of the player in this match who substituted out")
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
  const subInId = interaction.options.getString("sub-in-slot-id", true) as string;
  const subOutRaw = interaction.options.getString("sub-out-discord-id", true) as string;
  const subOutDiscordID = parseDiscordUserId(subOutRaw);
  if (!subOutDiscordID) {
    await interaction.reply({
      content: `${EMOJI_FAIL} Invalid sub-out Discord ID. Use a numeric ID or tag the user (e.g. <@123...>).`,
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
      const msg = await interaction.editReply(`${EMOJI_FAIL} Only original reporter <@${getMatchRes?.reporter_discord_id}> or a moderator can assign subs`).catch(() => null);
      if (msg) deleteLater(msg, 60_000);
      return;
    }
    const subInPlayerIndex = parseInt(subInId) - 1;
    if (subInPlayerIndex < 0 || subInPlayerIndex >= (getMatchRes?.players.length ?? 0)) {
      const msg = await interaction.editReply(`${EMOJI_FAIL} Invalid sub in player ID ${subInId} for match ${matchId}`).catch(() => null);
      if (msg) deleteLater(msg, 60_000);
      return;
    }
    const subInPlayer = getMatchRes?.players[subInPlayerIndex];
    const subInDiscordId = subInPlayer?.discord_id;
    if (!subInDiscordId) {
      const msg = await interaction.editReply(`${EMOJI_FAIL} SUB IN player is missing a Discord ID. Assign Discord IDs first, then retry.`).catch(() => null);
      if (msg) deleteLater(msg, 60_000);
      return;
    }
    if (subInPlayer.is_sub || subInPlayer.subbed_out) {
      const msg = await interaction.editReply(`${EMOJI_FAIL} Player already a sub assigned. Multiple subs is not allowed.`).catch(() => null);
      if (msg) deleteLater(msg, 60_000);
      return;
    }
    const assignSubMsg = await interaction.editReply(`Assigning substitute...\nSUB IN:<@${subInDiscordId}>\nSUB OUT:<@${subOutDiscordID}>`);
    const res = await assignSub(matchId, subInPlayerIndex.toString(), subOutDiscordID, assignSubMsg.id);

    const updatedEmbed = buildReportEmbed(res, {
      reporterId: interaction.user.id,
    });
    const embedMsgId = (res as BaseReport).discord_messages_id_list[0];
    if (embedMsgId && interaction.channel?.isTextBased()) {
      const message = await interaction.channel.messages.fetch(embedMsgId).catch(() => null);
      if (message) await message.edit({ embeds: [updatedEmbed] }).catch(() => undefined);
    }

    const header =
      `${EMOJI_CONFIRM} Substitute assigned by <@${interaction.user.id}>\nSUB IN:<@${subInDiscordId}>. SUB OUT:<@${subOutDiscordID}>` +
      `Match ID: **${res.match_id}**\n`;

    const full = header + convertMatchToStr(res as BaseReport, false);
    const chunks = Array.from(chunkByLength(full, MAX_DISCORD_LEN));
    const first = chunks[0] ?? header;
    await assignSubMsg.edit(first);
    for (const chunk of chunks.slice(1)) {
      await interaction.followUp({ content: chunk }).catch(() => undefined);
    }
  } catch (err: unknown) {
    const msg = await interaction.editReply(`${EMOJI_FAIL} Assign sub failed: ${errorMessage(err)}`).catch(() => null);
    if (msg) deleteLater(msg, 60_000);
  }
}