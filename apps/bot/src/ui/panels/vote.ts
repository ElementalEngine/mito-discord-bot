import { ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';

import type { SettingQuestion, Vote } from '../../api/types.js';
import { customId, field, fit, mention, nameOf, plainNameOf, portraitOf, text, type CivNames, type Panel } from '../kit/index.js';
import { AGES, MODES } from './draft.js';
import { draftOutputPanels } from './draft-output.js';
import { row } from './lobby.js';
import { closes, ticks } from './lobby-vote.js';

export const VOTE_VERB = { finished: 'finished', pick: 'pick', leader: 'leader', civ: 'civ', lockIn: 'lockin' } as const;

// The vote's messages by name: its status, each setting by its id, and bans.
export const VOTE_STATUS = 'status';
export const LEADER_BANS = 'leaders';
export const CIV_BANS = 'civs';

const button = (vote: Vote, verb: string, label: string, style: ButtonStyle, ...args: string[]): ButtonBuilder =>
  new ButtonBuilder().setCustomId(customId('vote', verb, vote.id, ...args)).setLabel(label).setStyle(style);

// The game: edition, mode and teams, and civ7's starting age unless left out.
export function voteTitle(vote: Vote, withAge = true): string {
  const edition = vote.edition === 'civ6' ? 'Civ6' : 'Civ7';
  const teams = vote.mode === 'teamer' ? `, ${vote.teams} teams` : '';
  const age = withAge && vote.edition === 'civ7' ? ` · ${vote.age ? AGES[vote.age] : 'every age'}` : '';
  return `${edition} ${MODES[vote.mode]}${teams}${age}`;
}

export const voteFooter = (vote: Vote): string => `Started by ${mention(vote.host_id)} · code ${vote.code}`;

// The vote's first message: what to do, who has finished, and Finished.
export function voteStatusPanel(vote: Vote): Panel {
  const bans = vote.edition === 'civ7' ? 'Ban leaders and civs on the bans messages' : 'Ban leaders on the bans message';
  return {
    tone: 'info',
    surface: 'vote',
    title: `Vote: ${voteTitle(vote)}`,
    subtitle: closes(vote, 'finished'),
    body: [
      text(
        `### React on each setting below\nBack as many options as you like, or none: the most reactions win, and a setting nobody reacts on keeps its default. ${bans}. Then press **Finished**.`,
      ),
      field('Players', ticks(vote, new Set(vote.vote.finished))),
    ],
    actions: [row(button(vote, VOTE_VERB.finished, 'Finished', ButtonStyle.Success))],
    footer: voteFooter(vote),
  };
}

// One setting's message: its options, each by the emoji to react with.
export function questionPanel(question: SettingQuestion): Panel {
  const lines = question.options.map((o) => `${o.emoji} ${o.label}${o.id === question.default_option_id ? ' (default)' : ''}`);
  return { tone: 'info', surface: 'vote', title: question.title, body: [text(lines.join('\n'))] };
}

// A bans message, for leaders or civ7's civs: react with the server's emojis.
// A ban lands with a majority and stays; the bans so far show here.
export function voteBansPanel(vote: Vote, kind: 'leader' | 'civ', names: CivNames): Panel {
  const need = Math.floor(vote.players.length / 2) + 1;
  const named = (by: string): string =>
    vote.bans
      .filter((b) => b.kind === kind && b.by === by)
      .map((b) => nameOf(names, b.token))
      .join(' · ');
  const [voted, before] = [named('vote'), named('host')];
  const what = kind === 'civ' ? 'civ' : 'leader';
  return {
    tone: 'info',
    surface: 'vote',
    title: kind === 'civ' ? 'Civ bans' : 'Leader bans',
    body: [
      text(
        `⬇️ React to this message with the server's ${what} emojis to ban them. A ${what} is banned once ${need} of the ${vote.players.length} players react, and stays banned.`,
      ),
      ...(voted ? [field('Banned by the vote', voted)] : []),
      ...(before ? [field('Banned before the vote', before)] : []),
    ],
  };
}

// The blind draft's message, where the vote's were: who has locked in, and
// the button that shows each player their own pool, privately.
export function voteBlindStatusPanel(vote: Vote): Panel {
  const what = vote.edition === 'civ7' ? 'a leader and a civ' : 'a leader';
  return {
    tone: 'info',
    surface: 'draft',
    title: `Blind draft: ${voteTitle(vote)}`,
    subtitle: closes(vote, 'locked in'),
    body: [
      text(`Press **Pick your leader** to see your pool and lock in ${what}; only you see it. The picks are revealed together, and anyone without a pick by the deadline gets an auto pick.`),
      field('Players', ticks(vote, new Set(vote.picks.map((p) => p.player_id)))),
    ],
    actions: [row(button(vote, VOTE_VERB.pick, 'Pick your leader', ButtonStyle.Primary))],
    footer: voteFooter(vote),
  };
}

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
  const label = ready ? `Lock in ${fit(plainNameOf(names, leader), 40)}${civ ? ` · ${fit(plainNameOf(names, civ), 40)}` : ''}` : 'Lock in';
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

