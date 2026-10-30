import { ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';

import type { SettingQuestion, Vote } from '../../api/types.js';
import { modeName } from '../../config/constants.js';
import { editionName } from '../../utils/edition.js';
import { customId, field, fit, mention, nameOf, plainNameOf, portraitOf, row, text, type CivNames, type Panel } from '../kit/index.js';
import { AGES } from './draft.js';
import { draftOutputPanels, settingLines } from './draft-output.js';
import { bannedBy, blindStatus, closes, majority, ticks } from './lobby-vote.js';

export const VOTE_VERB = { finished: 'finished', pick: 'pick', leader: 'leader', civ: 'civ', lockIn: 'lockin' } as const;

// The vote's ban messages by name, beside its status and each setting by id.
export const LEADER_BANS = 'leaders';
export const CIV_BANS = 'civs';

const button = (vote: Vote, verb: string, label: string, style: ButtonStyle, ...args: string[]): ButtonBuilder =>
  new ButtonBuilder().setCustomId(customId('vote', verb, vote.id, ...args)).setLabel(label).setStyle(style);

// The game: edition and mode, and civ7's starting age unless left out.
function voteTitle(vote: Vote, withAge = true): string {
  const age = withAge && vote.edition === 'civ7' ? ` · ${vote.age ? AGES[vote.age] : 'every age'}` : '';
  return `${editionName(vote.edition)} ${modeName(vote.mode)}${age}`;
}

const voteFooter = (vote: Vote): string => `Started by ${mention(vote.host_id)} · code ${vote.code}`;

// The vote's first message: what to do, the settings won so far, who has
// finished, and Finished.
export function voteStatusPanel(vote: Vote, questions: readonly SettingQuestion[]): Panel {
  const bans = vote.edition === 'civ7' ? 'Ban leaders and civs on the bans messages' : 'Ban leaders on the bans message';
  const won = questions.flatMap((q) => {
    const option = q.options.find((o) => o.id === vote.settings.find((s) => s.id === q.id)?.value);
    return option ? [`✅ ${q.title}: ${option.emoji} ${option.label}`] : [];
  });
  return {
    tone: 'info',
    surface: 'vote',
    title: `Vote: ${voteTitle(vote)}`,
    subtitle: closes(vote, 'finished'),
    body: [
      text(
        `### React on each setting below\nBack as many options as you like. An option backed by ${majority(vote)} of the ${vote.players.length} players wins at once and its message is cleared; the rest go to the most reactions once all finish, and the bot settles a tie. ${bans}. Then press **Finished**.`,
      ),
      ...(won.length ? [field('Won', won.join('\n'))] : []),
      field('Players', ticks(vote, new Set(vote.vote.finished))),
    ],
    actions: [row(button(vote, VOTE_VERB.finished, 'Finished', ButtonStyle.Success))],
    footer: voteFooter(vote),
  };
}

// One setting's message: its options, each by the emoji to react with.
export function questionPanel(question: SettingQuestion): Panel {
  const lines = question.options.map((o) => `${o.emoji} ${o.label}`);
  return { tone: 'info', surface: 'vote', title: question.title, body: [text(lines.join('\n'))] };
}

// A bans message, for leaders or civ7's civs: react with the server's emojis.
// A ban lands with a majority and stays; the bans so far show here.
export function voteBansPanel(vote: Vote, kind: 'leader' | 'civ', names: CivNames): Panel {
  const [voted, before] = [bannedBy(vote.bans, names, 'vote', kind), bannedBy(vote.bans, names, 'host', kind)];
  const what = kind === 'civ' ? 'civ' : 'leader';
  return {
    tone: 'info',
    surface: 'vote',
    title: kind === 'civ' ? 'Civ bans' : 'Leader bans',
    body: [
      text(
        `⬇️ React to this message with the server's ${what} emojis to ban them. A ${what} is banned once ${majority(vote)} of the ${vote.players.length} players react, and stays banned.`,
      ),
      ...(voted ? [field('Banned by the vote', voted)] : []),
      ...(before ? [field('Banned before the vote', before)] : []),
    ],
  };
}

// The blind draft's message, with the settings the vote chose kept in view.
export const voteBlindStatusPanel = (vote: Vote, questions: readonly SettingQuestion[]): Panel =>
  blindStatus(
    vote,
    `Blind draft: ${voteTitle(vote)}`,
    voteFooter(vote),
    button(vote, VOTE_VERB.pick, 'Pick your leader', ButtonStyle.Primary),
    vote.edition === 'civ7' ? 'a leader and a civ' : 'a leader',
    [field('Settings', settingLines(Object.fromEntries(vote.settings.map((s) => [s.id, s.value])), questions))],
  );

function menu(vote: Vote, verb: string, placeholder: string, tokens: readonly string[], names: CivNames, chosen: string | undefined, other: string | undefined): StringSelectMenuBuilder {
  return new StringSelectMenuBuilder()
    .setCustomId(customId('vote', verb, vote.id, ...(other ? [other] : [])))
    .setPlaceholder(placeholder)
    .addOptions(
      tokens.map((token) => {
        const emoji = portraitOf(names, token);
        return { label: fit(plainNameOf(names, token), 100), value: token, default: token === chosen, ...(emoji ? { emoji } : {}) };
      }),
    );
}

// A player's own pool, privately: a leader, and on civ7 a civ, chosen from the
// menus, then locked in together. Each menu carries the other's choice.
export function voteBlindPickPanel(vote: Vote, playerId: string, names: CivNames, leader?: string, civ?: string): Panel {
  const title = `Blind pick: ${voteTitle(vote)}`;
  const locked = vote.picks.find((p) => p.player_id === playerId);
  if (locked) {
    const what = `${plainNameOf(names, locked.leader)}${locked.civ ? ` · ${plainNameOf(names, locked.civ)}` : ''}`;
    return { tone: 'success', surface: 'draft', title, subtitle: `Locked in: ${what}. Revealed once every player has locked in.`, footer: voteFooter(vote) };
  }
  const pool = vote.pools.find((p) => p.player_id === playerId);
  const withCivs = (pool?.civs.length ?? 0) > 0;
  const ready = leader && (civ || !withCivs);
  const label = ready ? fit(`Lock in ${plainNameOf(names, leader)}${civ ? ` · ${plainNameOf(names, civ)}` : ''}`, 80) : 'Lock in';
  const lockIn = button(vote, VOTE_VERB.lockIn, label, ButtonStyle.Success, ...(ready ? [leader, ...(civ ? [civ] : [])] : [])).setDisabled(!ready);
  const lines = (tokens: readonly string[]): string => tokens.map((t) => nameOf(names, t)).join('\n');
  return {
    tone: 'info',
    surface: 'draft',
    title,
    subtitle: closes(vote, 'locked in'),
    body: [field('Your leaders', lines(pool?.leaders ?? [])), ...(withCivs ? [field('Your civs', lines(pool?.civs ?? []))] : [])],
    actions: [
      row(menu(vote, VOTE_VERB.leader, 'Choose your leader', pool?.leaders ?? [], names, leader, civ)),
      ...(withCivs ? [row(menu(vote, VOTE_VERB.civ, 'Choose your civ', pool?.civs ?? [], names, civ, leader))] : []),
      row(lockIn),
    ],
    footer: voteFooter(vote),
  };
}

// The vote's draft, posted as every draft is.
export function voteDraftPanels(vote: Vote, names: CivNames, questions: readonly SettingQuestion[]): Panel[] {
  const out = {
    title: `${voteTitle(vote, false)} draft`,
    footer: voteFooter(vote),
    draftMode: vote.draft_mode,
    teams: vote.teams,
    players: vote.players,
    pools: vote.pools,
    picks: vote.picks,
    settings: Object.fromEntries(vote.settings.map((s) => [s.id, s.value])),
    questions,
    bans: vote.bans,
    banKinds: vote.edition === 'civ7' ? (['leader', 'civ'] as const) : (['leader'] as const),
  };
  return draftOutputPanels(out, names);
}

