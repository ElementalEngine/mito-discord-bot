import type {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  Collection,
  Awaitable,
} from "discord.js";
export interface Command {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Awaitable<void>;
}
declare module "discord.js" {
  interface Client {
    commands: Collection<string, Command>;
  }
}

export {};