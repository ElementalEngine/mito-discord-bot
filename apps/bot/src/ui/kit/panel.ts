import {
  ContainerBuilder,
  FileBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
  type ActionRowBuilder,
  type ButtonBuilder,
  type MessageActionRowComponentBuilder,
  type MessageMentionOptions,
} from 'discord.js';

import { LIMITS, fit } from './limits.js';
import { SURFACES, TONES, type Surface, type Tone } from './tone.js';

// Every Mite message is one panel: a Components V2 container whose accent is
// its tone, a heading, a body, optional buttons and a footer line.
export type Block =
  | Readonly<{ kind: 'text'; text: string }>
  | Readonly<{ kind: 'divider'; large: boolean }>
  | Readonly<{ kind: 'aside'; text: string; button: ButtonBuilder }>
  | Readonly<{ kind: 'picture'; text: string; url: string; alt: string }>
  | Readonly<{ kind: 'file'; name: string }>;

export const text = (body: string): Block => ({ kind: 'text', text: body });
export const divider = (large = false): Block => ({ kind: 'divider', large });
export const field = (name: string, value: string): Block => text(`**${name}**\n${value || '\u2014'}`);
export const aside = (body: string, button: ButtonBuilder): Block => ({ kind: 'aside', text: body, button });
export const picture = (body: string, url: string, alt = ''): Block => ({ kind: 'picture', text: body, url, alt });
// An attachment sent with the message, shown where the block sits.
export const file = (name: string): Block => ({ kind: 'file', name });

export type ButtonRow = ActionRowBuilder<MessageActionRowComponentBuilder>;

export type Panel = Readonly<{
  tone: Tone;
  surface?: Surface;
  title?: string;
  subtitle?: string;
  body?: readonly Block[];
  actions?: readonly ButtonRow[];
  footer?: string;
  // A colour that means something on this surface, such as a rank, in place
  // of the tone's.
  accent?: number;
}>;

export type PanelMessage = {
  flags: MessageFlags.IsComponentsV2;
  components: ContainerBuilder[];
  allowedMentions: MessageMentionOptions;
};

// Mentions render but never ping unless a caller asks: an embed never
// pinged, and a panel replaces one.
const NO_PINGS: MessageMentionOptions = { parse: [] };

function heading(panel: Panel): string | null {
  if (!panel.title) return null;
  const mark = panel.surface ? `${SURFACES[panel.surface]} ` : '';
  const lines = [`## ${mark}${panel.title}`];
  if (panel.subtitle) lines.push(`-# ${panel.subtitle}`);
  return lines.join('\n');
}

// The blocks a panel renders, in order, with its heading and footer as text.
export function blocksOf(panel: Panel): Block[] {
  const blocks: Block[] = [];
  const head = heading(panel);
  if (head) blocks.push(text(head));
  if (head && panel.body?.length) blocks.push(divider());
  blocks.push(...(panel.body ?? []));
  if (panel.footer) blocks.push(divider(), text(`-# ${panel.footer}`));
  return blocks;
}

export function componentCount(blocks: readonly Block[], actions: readonly ButtonRow[] = []): number {
  let n = 1;
  for (const block of blocks) n += block.kind === 'aside' || block.kind === 'picture' ? 3 : 1;
  for (const row of actions) n += 1 + row.components.length;
  return n;
}

const textOf = (block: Block): string | null => ('text' in block ? block.text : null);

// Trim the longest text until the message fits Discord's total.
export function withinTextLimit(blocks: readonly Block[], limit: number = LIMITS.text): Block[] {
  const out = [...blocks];
  let total = out.reduce((sum, b) => sum + (textOf(b)?.length ?? 0), 0);
  while (total > limit) {
    let longest = -1;
    let longestLen = 1;
    out.forEach((b, i) => {
      const len = textOf(b)?.length ?? 0;
      if (len > longestLen) {
        longest = i;
        longestLen = len;
      }
    });
    if (longest < 0) break;
    const cut = fit(textOf(out[longest]!) ?? '', Math.max(1, longestLen - (total - limit)));
    out[longest] = { ...out[longest]!, text: cut } as Block;
    total -= longestLen - cut.length;
  }
  return out;
}

export function container(panel: Panel): ContainerBuilder {
  const blocks = withinTextLimit(blocksOf(panel));
  const actions = panel.actions ?? [];
  const count = componentCount(blocks, actions);
  if (count > LIMITS.components) {
    throw new Error(`panel "${panel.title ?? panel.tone}" has ${count} components; Discord allows ${LIMITS.components}`);
  }

  const box = new ContainerBuilder().setAccentColor(panel.accent ?? TONES[panel.tone].colour);
  for (const block of blocks) {
    switch (block.kind) {
      case 'text':
        box.addTextDisplayComponents(new TextDisplayBuilder().setContent(block.text));
        break;
      case 'divider':
        box.addSeparatorComponents(
          new SeparatorBuilder()
            .setDivider(true)
            .setSpacing(block.large ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small),
        );
        break;
      case 'aside':
        box.addSectionComponents(
          new SectionBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(block.text))
            .setButtonAccessory(block.button),
        );
        break;
      case 'picture': {
        const thumb = new ThumbnailBuilder().setURL(block.url);
        if (block.alt) thumb.setDescription(fit(block.alt, 1024));
        box.addSectionComponents(
          new SectionBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(block.text))
            .setThumbnailAccessory(thumb),
        );
        break;
      }
      case 'file':
        box.addFileComponents(new FileBuilder().setURL(`attachment://${block.name}`));
        break;
    }
  }
  if (actions.length) box.addActionRowComponents(...actions);
  return box;
}

export function panelMessage(panel: Panel, allowedMentions: MessageMentionOptions = NO_PINGS): PanelMessage {
  return { flags: MessageFlags.IsComponentsV2, components: [container(panel)], allowedMentions };
}

// A one-line answer to the person who acted: the tone's emoji and the text.
export function notice(tone: Tone, message: string): Panel {
  return { tone, body: [text(`${TONES[tone].emoji} ${message}`)] };
}
