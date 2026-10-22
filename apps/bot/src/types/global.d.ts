import type {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  Collection,
  Awaitable,
} from "discord.js";
export interface Command {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Awaitable<void>;
  // Declared by a command answered through ui/reply.ts; the dispatcher defers
  // it this way before it runs.
  visibility?: 'public' | 'private';
}
declare module "discord.js" {
  interface Client {
    commands: Collection<string, Command>;
  }
}

export {};