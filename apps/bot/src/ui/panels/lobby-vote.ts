import { ButtonStyle, StringSelectMenuBuilder } from 'discord.js';

import type { CivDataResponse, Lobby } from '../../api/types.js';
import { customId, field, fit, mention, nameOf, plainNameOf, portraitOf, text, when, type CivNames, type Panel } from '../kit/index.js';
import { SHAPES, VERB, button, lobbyFooter, row } from './lobby.js';

const closes = (lobby: Lobby, done: string): string => `Closes ${lobby.deadline ? when(Date.parse(lobby.deadline), 'R') : 'soon'}, or once every player has ${done}`;

const ticks = (lobby: Lobby, done: ReadonlySet<string>): string =>
  lobby.players.map((p) => `${done.has(p.discord_id) ? '✅' : '⬜'} ${mention(p.discord_id)}`).join('\n');

// The bans vote, one message: what to do, the host's bans, who has finished,
// and the button to finish. Players react on it.
export function voteStatusPanel(lobby: Lobby, names: CivNames): Panel {
  const need = Math.floor(lobby.players.length / 2) + 1;
  const hosts = lobby.bans.map((b) => nameOf(names, b.token)).join(' \u00b7 ');
  return {
    tone: 'info',
    surface: 'vote',
    title: `Bans vote: Civ6 ${SHAPES[lobby.shape]} lobby`,
    subtitle: closes(lobby, 'finished'),
    body: [
      field(
        'Optional: extra leader bans',
        `React to this message with the server's leader emojis to ban those leaders. A ban lands with ${need} of the ${lobby.players.length} players. Then press Finished.`,
      ),
      ...(hosts ? [field('Banned by the host', hosts)] : []),
      field('Players', ticks(lobby, new Set(lobby.vote?.finished ?? []))),
    ],
    actions: [row(button(lobby, VERB.finished, 'Finished', ButtonStyle.Success))],
    footer: lobbyFooter(lobby),
  };
}

// The blind draft's message, where the vote's was: who has locked in, and the
// button that shows each player their own pool, privately.
export function blindStatusPanel(lobby: Lobby): Panel {
  return {
    tone: 'info',
    surface: 'draft',
    title: `Blind draft: Civ6 ${SHAPES[lobby.shape]} lobby`,
    subtitle: closes(lobby, 'locked in'),
    body: [
      text('Press **Pick your leader** to see your pool and lock in a pick; only you see it. The picks are revealed together, and anyone without a pick by the deadline gets an auto pick.'),
      field('Players', ticks(lobby, new Set(lobby.picks.map((p) => p.player_id)))),
    ],
    actions: [row(button(lobby, VERB.pick, 'Pick your leader', ButtonStyle.Primary))],
    footer: lobbyFooter(lobby),
  };
}

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
