import type { Message } from 'discord.js';

export type DeletableMessage = Pick<Message, 'delete'>;

export async function safeDelete(
  message?: DeletableMessage | null
): Promise<void> {
  if (!message) return;
  await message.delete().catch(() => undefined);
}

export function deleteLater(message: DeletableMessage, ms: number): void {
  const timeout = setTimeout(() => {
    void safeDelete(message);
  }, ms);
  timeout.unref?.();
}
