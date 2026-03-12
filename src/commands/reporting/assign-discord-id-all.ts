import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { config } from "../../config.js";
import { EMOJI_CONFIRM, EMOJI_FAIL, MAX_DISCORD_LEN } from "../../config/constants.js";
import { assignDiscordIdAll } from "../../services/reporting.service.js";
import { buildReportEmbed } from "../../ui/embeds/reporting.js";
import { chunkByLength } from "../../utils/chunk-by-length.js";
import { convertMatchToStr } from "../../utils/convert-match-to-str.js";
import { parseDiscordUserId } from "../../utils/parse-discord-id.js";
import { deleteLater } from "../../utils/discord-safe.js";
import { errorMessage } from "../../utils/error-message.js";
import { logCommand } from "../../utils/log-command.js";

import type { BaseReport } from "../../types/reporting.types.js";

export const data = new SlashCommandBuilder()
  .setName("assign-discord-id-all")
  .setDescription("Set all players discord id in order.")
  .addStringOption(option =>
    option.setName("match-id")
      .setDescription("ID of the match to change discord id of a player")
      .setRequired(true),
  )
  .addStringOption(option =>
    option.setName("discord-id-list")
      .setDescription("List of players discord IDs separated by space (you can also tag players)")
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
  const discordIdList = interaction.options.getString("discord-id-list", true) as string;
  await logCommand(interaction, 
    config.discord.channels.reportLogChannel,
    data.name,
    {
      matchId: matchId,
      discordIdList: discordIdList,
    }
  );
  const rawTokens = discordIdList.trim().split(/\s+/).filter(Boolean);
  const parsed = rawTokens.map((t) => parseDiscordUserId(t));
  const invalidIdx = parsed.findIndex((v) => v === null);
  if (invalidIdx !== -1) {
    await interaction.reply({
      content: `${EMOJI_FAIL} Invalid Discord ID at position ${invalidIdx + 1}. Use numeric IDs or tag users (e.g. <@123...>).`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const discordIds = parsed.filter((v): v is string => v !== null);
  const isCloudChannel = interaction.channelId === config.discord.channels.civ6cloudUploads ||
    interaction.channelId === config.discord.channels.civ7cloudUploads;

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
    const assignDiscordIdMsg = await interaction.editReply(`Processing assign discord id all request...`);
    if (!interaction.member.roles.cache.has(config.discord.roles.moderator) && !isCloudChannel) {
      const msg = await interaction.editReply(`${EMOJI_FAIL} Only a moderator can assign a player discord id.`);
      deleteLater(msg, 60_000);
      return;
    }
    const res = await assignDiscordIdAll(matchId, discordIds, assignDiscordIdMsg.id);

    const updatedEmbed = buildReportEmbed(res, {
      reporterId: interaction.user.id,
    });
    const embedMsgId = (res as BaseReport).discord_messages_id_list[0];
    const message = await interaction.channel?.messages.fetch(embedMsgId);
    if (message) {
      await message.edit({ embeds: [updatedEmbed] });
    }

    const playerMentions = discordIds.map((p) => `<@${p}>`).join(', ');
    const header =
      `${EMOJI_CONFIRM} ${playerMentions}\nDiscord ID assigned by <@${interaction.user.id}>\n` +
      `Match ID: **${res.match_id}**\n`;

    const full = header + convertMatchToStr(res as BaseReport, false);
    const chunks = Array.from(chunkByLength(full, MAX_DISCORD_LEN));
    const first = chunks[0] ?? header;
    await assignDiscordIdMsg.edit(first);
    for (const chunk of chunks.slice(1)) {
      await interaction.followUp({ content: chunk }).catch(() => undefined);
    }
  } catch (err: unknown) {
    const msg = await interaction.editReply(`${EMOJI_FAIL} Discord ID assignment failed: ${errorMessage(err)}`).catch(() => null);
    if (msg) deleteLater(msg, 60_000);
  }
}