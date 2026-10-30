import { ButtonStyle, StringSelectMenuBuilder, type ButtonBuilder } from 'discord.js';

import type { CivDataResponse, Lobby, SettingQuestion } from '../../api/types.js';
import { customId, field, fit, mention, nameOf, plainNameOf, portraitOf, row, text, when, type Block, type CivNames, type Panel } from '../kit/index.js';
import { PUT_TO_VOTE, settingLines } from './draft-output.js';
import { SHAPES, VERB, button, lobbyFooter } from './lobby.js';

type Timed = Readonly<{ deadline: string | null; players: readonly Readonly<{ discord_id: string }>[] }>;

export const closes = (setup: Timed, done: string): string =>
  `Closes ${setup.deadline ? when(Date.parse(setup.deadline), 'R') : 'soon'}, or once every player has ${done}`;

export const ticks = (setup: Timed, done: ReadonlySet<string>): string =>
  setup.players.map((p) => `${done.has(p.discord_id) ? '✅' : '⬜'} ${mention(p.discord_id)}`).join('\n');

// A majority of the players: what lands a ban, or wins a setting, at once.
export const majority = (setup: Timed): number => Math.floor(setup.players.length / 2) + 1;

export const bannedBy = (bans: Lobby['bans'], names: CivNames, by: string, kind = 'leader'): string =>
  bans
    .filter((b) => b.kind === kind && b.by === by)
    .map((b) => nameOf(names, b.token))
    .join(' \u00b7 ');

// A blind draft's message, where the vote's was: who has locked in, anything
// else to keep in view, and the button that shows each player their own pool.
export function blindStatus(setup: Timed & Pick<Lobby, 'picks'>, title: string, footer: string, pick: ButtonBuilder, what: string, more: readonly Block[] = []): Panel {
  return {
    tone: 'info',
    surface: 'draft',
    title,
    subtitle: closes(setup, 'locked in'),
    body: [
      text(`Press **Pick your leader** to see your pool and lock in ${what}; only you see it. The picks are revealed together, and anyone without a pick by the deadline gets an auto pick.`),
      field('Players', ticks(setup, new Set(setup.picks.map((p) => p.player_id)))),
      ...more,
    ],
    actions: [row(pick)],
    footer,
  };
}

// The settings the host put to the vote that the players have yet to settle.
export const votedOn = (lobby: Lobby, questions: readonly SettingQuestion[]): SettingQuestion[] =>
  questions.filter((q) => lobby.settings.some((s) => s.id === q.id && s.value === PUT_TO_VOTE));

// The vote's status message: the settings put to the vote and those won, the
// extra bans, who has finished, and the button to finish. Bans are reactions on it.
export function bansVotePanel(lobby: Lobby, names: CivNames, questions: readonly SettingQuestion[]): Panel {
  const [hosts, voted] = [bannedBy(lobby.bans, names, 'host'), bannedBy(lobby.bans, names, 'vote')];
  const asked = questions.filter((q) => lobby.settings.some((s) => s.id === q.id && (s.value === PUT_TO_VOTE || s.by === 'vote')));
  const won = asked.filter((q) => !votedOn(lobby, questions).includes(q));
  const settings = asked.length
    ? [
        text(
          `### Settings put to the vote\nReact on each setting below. An option backed by ${majority(lobby)} of the ${lobby.players.length} players wins at once; the rest go to the most reactions when the vote closes.`,
        ),
        ...(won.length ? [field('Won', settingLines(Object.fromEntries(lobby.settings.map((s) => [s.id, s.value])), won))] : []),
      ]
    : [];
  return {
    tone: 'info',
    surface: 'vote',
    title: `${asked.length ? 'Vote' : 'Bans vote'}: Civ6 ${SHAPES[lobby.shape]} lobby`,
    subtitle: closes(lobby, 'finished'),
    body: [
      ...settings,
      text(
        `### Optional: extra leader bans\n⬇️ React to this message with the server's leader emojis to ban those leaders. A leader is banned once ${majority(lobby)} of the ${lobby.players.length} players react, and stays banned. Then press **Finished**.`,
      ),
      ...(voted ? [field('Banned by the vote', voted)] : []),
      ...(hosts ? [field('Banned by the host', hosts)] : []),
      field('Players', ticks(lobby, new Set(lobby.vote?.finished ?? []))),
    ],
    actions: [row(button(lobby, VERB.finished, 'Finished', ButtonStyle.Success))],
    footer: lobbyFooter(lobby),
  };
}

export const blindStatusPanel = (lobby: Lobby): Panel =>
  blindStatus(lobby, `Blind draft: Civ6 ${SHAPES[lobby.shape]} lobby`, lobbyFooter(lobby), button(lobby, VERB.pick, 'Pick your leader', ButtonStyle.Primary), 'a pick');

// A player's own pool, each leader with their civ, then chosen from the menu
// and locked in. Once locked, it shows the pick until the reveal.
export function blindPickPanel(lobby: Lobby, playerId: string, names: CivNames, data: CivDataResponse, chosen?: string): Panel {
  const title = `Blind pick: Civ6 ${SHAPES[lobby.shape]} lobby`;
  const locked = lobby.picks.find((p) => p.player_id === playerId)?.leader;
  if (locked) {
    return { tone: 'success', surface: 'draft', title, subtitle: `Locked in: ${plainNameOf(names, locked)}. Revealed once every player has locked in.`, footer: lobbyFooter(lobby) };
  }
  const civOf: ReadonlyMap<string, string> = new Map(data.leaders.flatMap((l) => (l.civ_display ? [[l.token, l.civ_display] as [string, string]] : [])));
  const pool = lobby.pools.find((p) => p.player_id === playerId)?.leaders ?? [];
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId('lobby', VERB.picked, lobby.id))
    .setPlaceholder('Choose your leader')
    .addOptions(
      pool.map((token) => {
        const emoji = portraitOf(names, token);
        const description = civOf.get(token);
        return { label: fit(plainNameOf(names, token), 100), value: token, default: token === chosen, ...(description ? { description: fit(description, 100) } : {}), ...(emoji ? { emoji } : {}) };
      }),
    );
  const lockIn = button(lobby, VERB.lockIn, chosen ? `Lock in ${fit(plainNameOf(names, chosen), 60)}` : 'Lock in', ButtonStyle.Success, ...(chosen ? [chosen] : [])).setDisabled(!chosen);
  return {
    tone: 'info',
    surface: 'draft',
    title,
    subtitle: closes(lobby, 'locked in'),
    body: [field('Your pool', pool.map((token) => `${nameOf(names, token)}${civOf.has(token) ? ` · ${civOf.get(token)}` : ''}`).join('\n'))],
    actions: [row(menu), row(lockIn)],
    footer: lobbyFooter(lobby),
  };
}
