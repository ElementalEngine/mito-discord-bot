import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { config } from "../../../core/config/index.js";
import { EMOJI_CONFIRM, EMOJI_FAIL, MAX_DISCORD_LEN } from "../../../core/config/constants.js";
import { triggerQuit, getMatch } from "../service.js";
import { buildReportEmbed } from "../ui/reporting.embed.js";
import { chunkByLength } from "../chunk-by-length.js";
import { convertMatchToStr } from "../format.js";
import { parseDiscordUserId } from "../parse-discord-id.js";
import { deleteLater } from "../../../core/discord/index.js";
import { errorMessage } from "../../../core/errors.js";
import { logCommand } from "../../../core/discord/index.js";

import type { BaseReport } from "../types.js";

export const data = new SlashCommandBuilder()
  .setName("trigger-quit")
  .setDescription("Set/Unset a player to be marked for quit.")
  .addStringOption(option =>
    option.setName("match-id")
      .setDescription("ID of the match to change the quit for")
      .setRequired(true),
  )
  .addStringOption(option =>
    option.setName("quitter-discord-id")
      .setDescription("Discord ID of the player who quit")
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
  const quitterRaw = interaction.options.getString("quitter-discord-id", true) as string;
  const quitterDiscordId = parseDiscordUserId(quitterRaw);
  await logCommand(interaction, 
    config.discord.channels.reportLogChannel,
    data.name,
    {
      matchId: matchId,
      quitterDiscordId: quitterDiscordId,
    }
  );
  if (!quitterDiscordId) {
    await interaction.reply({
      content: `${EMOJI_FAIL} Invalid quitter Discord ID. Use a numeric ID or tag the user (e.g. <@123...>).`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

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
    if (!interaction.inCachedGuild()) throw new Error('Not a cached guild');
    const triggerQuitMsg = await interaction.editReply(`<@&${config.discord.roles.moderator}> Processing trigger quit request for <@${quitterDiscordId}>...`);
    if (!interaction.member.roles.cache.has(config.discord.roles.moderator)) {
      const getMatchRes = await getMatch(matchId);
      if (getMatchRes?.reporter_discord_id != interaction.user.id) {
        await interaction.editReply(`${EMOJI_FAIL} Only original reporter <@${getMatchRes?.reporter_discord_id}> or a moderator can report a quit`);
        return;
      }
    }
    const res = await triggerQuit(matchId, quitterDiscordId, triggerQuitMsg.id);
    const updatedEmbed = buildReportEmbed(res, {
      reporterId: interaction.user.id,
    });
    const embedMsgId = (res as BaseReport).discord_messages_id_list[0];
    const message = await interaction.channel?.messages.fetch(embedMsgId);
    if (message) {
      await message.edit({ embeds: [updatedEmbed] });
    }
    const header =
      `${EMOJI_CONFIRM} <@&${config.discord.roles.moderator}> Player <@${quitterDiscordId}> quit is triggered by <@${interaction.user.id}>\n` +
      `Match ID: **${res.match_id}**\n`;

    const full = header + convertMatchToStr(res as BaseReport, false);
    const chunks = Array.from(chunkByLength(full, MAX_DISCORD_LEN));
    const first = chunks[0] ?? header;

    await interaction.editReply(first);
    for (const chunk of chunks.slice(1)) {
      await interaction.followUp({ content: chunk }).catch(() => undefined);
    }
  } catch (err: unknown) {
    const msg = await interaction.editReply(`${EMOJI_FAIL} Upload failed: ${errorMessage(err)}`).catch(() => null);
    if (msg) deleteLater(msg, 60_000);
  }
}