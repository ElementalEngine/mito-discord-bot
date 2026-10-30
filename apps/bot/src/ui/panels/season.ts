import { ButtonBuilder, ButtonStyle } from 'discord.js';

import type { CivVersion, SeasonPreview, SeasonRolled } from '../../api/types.js';
import { modeName } from '../../config/constants.js';
import { editionName, versionOf } from '../../utils/edition.js';
import { customId, notice, row, text, when, type Panel } from '../kit/index.js';

export const SEASON = { surface: 'season', start: 'start', cancel: 'cancel' } as const;

// rt_ffa reads as Realtime FFA, pbc_teamer as Cloud Teamer.
export function collectionName(name: string): string {
  const [kind = '', mode = ''] = name.split('_');
  const where = kind === 'pbc' ? 'Cloud' : kind === 'rt' ? 'Realtime' : kind;
  return `${where} ${modeName(mode)}`.trim();
}

const total = (records: Readonly<Record<string, number>>): number => Object.values(records).reduce((a, b) => a + b, 0);

const recordLines = (records: Readonly<Record<string, number>>): string =>
  Object.entries(records)
    .filter(([, n]) => n > 0)
    .map(([name, n]) => `${collectionName(name)}: ${n.toLocaleString('en-GB')}`)
    .join('\n') || 'No season records.';

// A label goes into a button id, where spaces are not allowed.
export const labelToId = (label: string): string => label.replace(/ /g, '_');
export const labelFromId = (part: string): string => part.replace(/_/g, ' ');

const button = (verb: string, edition: CivVersion, label: string, title: string, style: ButtonStyle) =>
  new ButtonBuilder()
    .setCustomId(customId(SEASON.surface, verb, edition, labelToId(label)))
    .setLabel(title)
    .setStyle(style);

// What starting the next season does, before it does it. The panel is private
// to the developer who asked, so the buttons are theirs alone.
export function seasonPreviewPanel(preview: SeasonPreview): Panel {
  const edition = versionOf(preview.edition);
  return {
    tone: 'info',
    surface: 'season',
    title: 'Start a new season',
    subtitle: `${editionName(edition)} \u00b7 ${preview.label} \u2192 ${preview.next_label}`,
    body: [
      text(`**${preview.label}** started ${when(new Date(preview.started_at), 'D')}.`),
      text(
        `Starting **${preview.next_label}** saves ${preview.label}'s season stats to a backup on the server, then clears them:\n${recordLines(preview.records)}`,
      ),
      text('Lifetime stats, match history and rank roles stay as they are.'),
    ],
    actions: [
      row(
        button(SEASON.start, edition, preview.label, `Start ${preview.next_label}`, ButtonStyle.Danger),
        button(SEASON.cancel, edition, preview.label, 'Cancel', ButtonStyle.Secondary),
      ),
    ],
    footer: 'Nothing changes until you press Start.',
  };
}

export function seasonStartedPanel(rolled: SeasonRolled): Panel {
  return {
    tone: 'success',
    surface: 'season',
    title: 'New season started',
    subtitle: `${editionName(rolled.edition)} \u00b7 ${rolled.opened}`,
    body: [
      text(`**${rolled.opened}** has started. ${rolled.closed}'s ${total(rolled.records).toLocaleString('en-GB')} season records were saved, then cleared.`),
    ],
    footer: `Backup: ${rolled.backup}`,
  };
}

export const seasonCancelledPanel = (): Panel => notice('muted', 'Nothing changed. The season carries on.');
