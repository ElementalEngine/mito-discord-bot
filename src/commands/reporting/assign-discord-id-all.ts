import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { config } from "../../config.js";
import { EMOJI_CONFIRM, EMOJI_FAIL, MAX_DISCORD_LEN } from "../../config/constants.js";
import { assignDiscordIdAll } from "../../services/reporting.service.js";
import { buildReportEmbed } from "../../ui/layouts/report.layout.js";
import { chunkByLength } from "../../utils/chunk-by-length.js";
import { convertMatchToStr } from "../../utils/convert-match-to-str.js";

import type { BaseReport } from "../../types/reports.js";

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
  let discordIds = discordIdList.split(' ').map(id => {
    if (id.startsWith('<@') && id.endsWith('>')) {
      return id.slice(2, -1);
    }
    return id;
  });
  discordIds = discordIds.filter(id => id.length > 0);
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
      await interaction.editReply(`${EMOJI_FAIL} Only a moderator can assign a player discord id.`)
        .then(repliedMessage => {
            setTimeout(() => repliedMessage.delete(), 60 * 1000);
          })
        .catch();
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

    let playerMentions = discordIds.map(p => `<@${p}>`).join(', ');
    const header =
      `${EMOJI_CONFIRM} ${playerMentions}\nDiscord ID assigned by <@${interaction.user.id}>\n` +
      `Match ID: **${res.match_id}**\n`;

    const full = header + convertMatchToStr(res as BaseReport, false);
    assignDiscordIdMsg.edit(full);
  } catch (err: any) {
    const msg = err?.body ? `${err.message}: ${JSON.stringify(err.body)}` : (err?.message ?? "Unknown error");
    await interaction.editReply(`${EMOJI_FAIL} Discord ID assignment failed: ${msg}`)
      .then(repliedMessage => {
          setTimeout(() => repliedMessage.delete(), 60 * 1000);
        })
      .catch();
  }
}