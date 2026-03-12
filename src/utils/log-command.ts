import { ChatInputCommandInteraction, TextChannel } from "discord.js";

export async function logCommand(interaction: ChatInputCommandInteraction, logChannelID: string, commandName: string, additionalInfo: Record<string, unknown> = {}): Promise<void> {
  const logChannel = interaction.client.channels.cache.get(logChannelID);
  if (logChannel && logChannel.isTextBased()) {
    await (logChannel as TextChannel).send({ content: `Command executed: \`${commandName}\` by <@${interaction.user.id}> in <#${interaction.channelId}> with info: \`${JSON.stringify(additionalInfo)}\`` });
  } else {
    console.warn(`Log channel with ID ${logChannelID} not found or is not text-based. Log info:`, additionalInfo);
  }
}