import { ChannelType, type ChatInputCommandInteraction, type MessageMentionOptions, type SlashCommandOptionsOnlyBuilder } from 'discord.js';

import { config } from '../config.js';

// /roll and /mapseed post where players set up a game, and share the options
// that say what the result is for.
export const POST_POLICY = {
  allowedChannelIds: [
    config.discord.channels.botTesting,
    config.discord.channels.civ6Commands,
    config.discord.channels.civ7Commands,
    config.discord.channels.cloudCommands,
    config.discord.channels.civ6ffaVote,
    config.discord.channels.civ6teamerVote,
  ],
  requiredRoleIds: [config.discord.roles.civ6Rank, config.discord.roles.civ7Rank, config.discord.roles.civCloud],
  allowDeveloperOverride: true,
} as const;

export type PostAbout = Readonly<{ label: string; userId: string | null; channelId: string | null }>;

// A plain builder is taken too: it is an options-only builder that has no options yet.
export function withPostOptions(builder: SlashCommandOptionsOnlyBuilder): SlashCommandOptionsOnlyBuilder {
  return builder
    .addStringOption((o) => o.setName('label').setDescription('What it is for, shown in the title').setMaxLength(120))
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
