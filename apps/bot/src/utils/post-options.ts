import { ChannelType, type ChatInputCommandInteraction, type MessageMentionOptions, type SharedSlashCommandOptions } from 'discord.js';

export type PostAbout = Readonly<{ label: string; userId: string | null; channelId: string | null }>;

export const LABEL_MAX = 120;

// The options that say what a result is for, on a command or a subcommand.
export function withPostOptions<T extends SharedSlashCommandOptions<T>>(builder: SharedSlashCommandOptions<T>): T {
  return builder
    .addStringOption((o) => o.setName('label').setDescription('What it is for, shown in the title').setMaxLength(LABEL_MAX))
    .addUserOption((o) => o.setName('tag').setDescription('A player to notify'))
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('A channel or thread to point to')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread),
    );
}

export const postAboutOf = (interaction: ChatInputCommandInteraction): PostAbout => ({
  label: interaction.options.getString('label')?.trim() ?? '',
  userId: interaction.options.getUser('tag')?.id ?? null,
  channelId: interaction.options.getChannel('channel')?.id ?? null,
});

// The tagged player is notified; nobody else is.
export const tagPing = (about: PostAbout): MessageMentionOptions => ({ parse: [], users: about.userId ? [about.userId] : [] });
