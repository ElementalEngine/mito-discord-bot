import type { ModalSubmitInteraction } from 'discord.js';

// What a form sent back. A field left untouched may come back absent rather
// than empty, so absence reads as nothing chosen.
export function selectedIn(interaction: ModalSubmitInteraction, fieldIds: readonly string[]): string[] {
  return fieldIds.flatMap((id) => {
    try {
      return [...interaction.fields.getStringSelectValues(id)];
    } catch {
      return [];
    }
  });
}

export function typedIn(interaction: ModalSubmitInteraction, fieldId: string): string {
  try {
    return interaction.fields.getTextInputValue(fieldId);
  } catch {
    return '';
  }
}
