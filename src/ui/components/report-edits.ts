import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
} from 'discord.js';

import { REPORT_EDITS_CID } from '../../interactions/report-edits.js';
import type {
  ReportEditsAction,
  ReportEditsOrderDraft,
  ReportEditsState,
} from '../../types/report-edits.js';

function ordinal(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n}st`;
  if (mod10 === 2 && mod100 !== 12) return `${n}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${n}rd`;
  return `${n}th`;
}

export function buildActionSelect(state: ReportEditsState) {
  const selected = state.action;

  const menu = new StringSelectMenuBuilder()
    .setCustomId(REPORT_EDITS_CID.action)
    .setPlaceholder('Choose action')
    .addOptions(
      {
        label: 'Assign Sub',
        value: 'SUB_ASSIGN' satisfies ReportEditsAction,
        default: selected === 'SUB_ASSIGN',
      },
      {
        label: 'Remove Sub',
        value: 'SUB_REMOVE' satisfies ReportEditsAction,
        default: selected === 'SUB_REMOVE',
      },
      {
        label: 'Assign Discord IDs',
        value: 'DISCORD_ID' satisfies ReportEditsAction,
        default: selected === 'DISCORD_ID',
      },
      {
        label: 'Change Report Order',
        value: 'ORDER' satisfies ReportEditsAction,
        default: selected === 'ORDER',
      },
      {
        label: 'Trigger Quit',
        value: 'TRIGGER_QUIT' satisfies ReportEditsAction,
        default: selected === 'TRIGGER_QUIT',
      },
      {
        label: 'Trigger Lagger',
        value: 'TRIGGER_LAGGER' satisfies ReportEditsAction,
        default: selected === 'TRIGGER_LAGGER',
      }
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export function buildSubInSelect(state: ReportEditsState) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(REPORT_EDITS_CID.subIn)
    .setPlaceholder('Select sub-in slot')
    .setMinValues(1)
    .setMaxValues(1);

  const eligible = state.match.players
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => !p.is_sub && !p.subbed_out);

  for (const { p, idx } of eligible) {
    const label = `#${idx + 1} ${p.user_name ?? 'Unknown'}${p.discord_id ? '' : ' (no discord id)'}`;
    menu.addOptions({
      label: label.slice(0, 100),
      value: String(idx),
      default: state.subInIndex === idx,
    });
  }

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export function buildSubOutUserSelect(_state: ReportEditsState) {
  const menu = new UserSelectMenuBuilder()
    .setCustomId(REPORT_EDITS_CID.subOut)
    .setPlaceholder('Select sub-out user')
    .setMinValues(1)
    .setMaxValues(1);

  return new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(menu);
}

export function buildRemoveSubSelect(state: ReportEditsState) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(REPORT_EDITS_CID.removeSub)
    .setPlaceholder('Select sub slot to remove')
    .setMinValues(1)
    .setMaxValues(1);

  const removable = state.match.players
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => p.subbed_out);

  for (const { p, idx } of removable) {
    const label = `#${idx + 1} ${p.discord_id ? `<@${p.discord_id}>` : p.user_name ?? 'Unknown'}`;
    menu.addOptions({
      label: label.slice(0, 100),
      value: String(idx),
      default: state.removeSubIndex === idx,
    });
  }

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export function buildOrderTargetSelect(state: ReportEditsState) {
  const draft = state.orderDraft;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(REPORT_EDITS_CID.orderTeam)
    .setPlaceholder(draft?.kind === 'team' ? 'Select team' : 'Select player')
    .setMinValues(1)
    .setMaxValues(1);

  if (!draft) {
    menu.setDisabled(true);
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
  }

  if (typeof state.orderSelectedPlacement !== 'number') {
    menu.setDisabled(true).setPlaceholder('Select placement first');
    for (const teamId of draft.teamIds) {
      const label =
        draft.kind === 'team'
          ? `Team ${teamId + 1}`
          : (() => {
              const idx = state.match.players.findIndex((p) => p.team === teamId);
              const p = idx >= 0 ? state.match.players[idx] : undefined;
              const name = p?.user_name ?? 'Unknown';
              return idx >= 0 ? `#${idx + 1} ${name}` : `Player ${teamId + 1}`;
            })();
      menu.addOptions({ label, value: String(teamId), default: false });
    }
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
  }

  const teamAtSelectedPlacement = draft.teamIds.find(
    (t) => draft.placementsByTeamId[t] === state.orderSelectedPlacement
  );
  const defaultTeamId =
    typeof state.orderSelectedTeamId === 'number'
      ? state.orderSelectedTeamId
      : teamAtSelectedPlacement;

  for (const teamId of draft.teamIds) {
    const label =
      draft.kind === 'team'
        ? `Team ${teamId + 1}`
        : (() => {
            const idx = state.match.players.findIndex((p) => p.team === teamId);
            const p = idx >= 0 ? state.match.players[idx] : undefined;
            const name = p?.user_name ?? 'Unknown';
            return idx >= 0 ? `#${idx + 1} ${name}` : `Player ${teamId + 1}`;
          })();
    menu.addOptions({
      label,
      value: String(teamId),
      default: defaultTeamId === teamId,
    });
  }

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export function buildDiscordSlotSelect(state: ReportEditsState) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(REPORT_EDITS_CID.discordSlot)
    .setPlaceholder('Select slot missing Discord ID')
    .setMinValues(1)
    .setMaxValues(1);

  const missing = state.match.players
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => !p.discord_id);

  if (missing.length === 0) {
    menu.setDisabled(true).setPlaceholder('No missing Discord IDs');
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
  }

  for (const { p, idx } of missing) {
    const name = p.user_name ?? 'Unknown';
    const label = `#${idx + 1} ${name}`;
    menu.addOptions({
      label: label.slice(0, 100),
      value: String(idx),
      default: state.discordIdSlotIndex === idx,
    });
  }

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export function buildDiscordUserSelect(state: ReportEditsState) {
  const menu = new UserSelectMenuBuilder()
    .setCustomId(REPORT_EDITS_CID.discordUser)
    .setPlaceholder('Select Discord user')
    .setMinValues(1)
    .setMaxValues(1);

  if (typeof state.discordIdSlotIndex !== 'number') {
    menu.setDisabled(true).setPlaceholder('Select a slot first');
  }

  return new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(menu);
}

export function buildOrderPlacementSelect(state: ReportEditsState) {
  const draft = state.orderDraft;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(REPORT_EDITS_CID.orderPlacement)
    .setPlaceholder('Select placement')
    .setMinValues(1)
    .setMaxValues(1);

  if (!draft) {
    menu.setDisabled(true);
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
  }

  for (let i = 1; i <= draft.teamIds.length; i++) {
    menu.addOptions({
      label: ordinal(i),
      value: String(i),
      default: state.orderSelectedPlacement === i,
    });
  }

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export function buildTriggerPlayerSelect(state: ReportEditsState) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(REPORT_EDITS_CID.triggerPlayer)
    .setPlaceholder('Select player')
    .setMinValues(1)
    .setMaxValues(1);

  for (const p of state.match.players) {
    if (!p.discord_id) continue;
    const label = p.user_name ?? `Player <@${p.discord_id}>`;
    menu.addOptions({
      label: label.slice(0, 100),
      value: p.discord_id,
      default: state.triggerDiscordId === p.discord_id,
    });
  }

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export function buildButtons(opts: {
  showBack: boolean;
  canApply: boolean;
  disableAll: boolean;
  showEnterId?: boolean;
}) {
  const back = new ButtonBuilder()
    .setCustomId(REPORT_EDITS_CID.back)
    .setLabel('Back')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(opts.disableAll || !opts.showBack);

  const enter = new ButtonBuilder()
    .setCustomId(REPORT_EDITS_CID.discordEnter)
    .setLabel('Enter ID')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(opts.disableAll);

  const apply = new ButtonBuilder()
    .setCustomId(REPORT_EDITS_CID.apply)
    .setLabel('Apply')
    .setStyle(ButtonStyle.Success)
    .setDisabled(opts.disableAll || !opts.canApply);

  const finish = new ButtonBuilder()
    .setCustomId(REPORT_EDITS_CID.finish)
    .setLabel('Finish')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(opts.disableAll);

  const cancel = new ButtonBuilder()
    .setCustomId(REPORT_EDITS_CID.cancel)
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Danger)
    .setDisabled(opts.disableAll);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(back);
  if (opts.showEnterId) row.addComponents(enter);
  row.addComponents(apply, finish, cancel);
  return row;
}

export function summarizeOrderDraft(draft: ReportEditsOrderDraft): string {
  const pairs = draft.teamIds.map((teamId) => {
    const placement = draft.placementsByTeamId[teamId];
    const label = draft.kind === 'team' ? `T${teamId + 1}` : `P${teamId + 1}`;
    return `${label}:${placement ?? '?'}`;
  });
  return pairs.join('  ');
}
