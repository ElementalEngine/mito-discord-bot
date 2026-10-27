import { ButtonStyle, StringSelectMenuBuilder } from 'discord.js';

import type { Lobby } from '../../api/types.js';
import { customId, field, fit, mention, nameOf, plainNameOf, portraitOf, text, when, type CivNames, type Panel } from '../kit/index.js';
import { SHAPES, VERB, button, row } from './lobby.js';

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
  };
}

// The blind draft's message, where the vote's was: who has locked in. Pools
// go out by DM; the button shows one here to anyone the DM missed.
export function blindStatusPanel(lobby: Lobby): Panel {
  return {
    tone: 'info',
    surface: 'draft',
    title: `Blind draft: Civ6 ${SHAPES[lobby.shape]} lobby`,
    subtitle: closes(lobby, 'locked in'),
    body: [
      text('Your pool is in your DMs: pick a leader and lock it in. No DM? Press Pick here. The picks are revealed together; no pick by the deadline is an auto pick.'),
      field('Players', ticks(lobby, new Set(lobby.picks.map((p) => p.player_id)))),
    ],
    actions: [row(button(lobby, VERB.pick, 'Pick here', ButtonStyle.Secondary))],
  };
}

const pickTitle = (lobby: Lobby): string => `Blind pick: Civ6 ${SHAPES[lobby.shape]} lobby`;

// A player's own pool: a leader chosen from the menu, then locked in. Once
// locked, it shows the pick until the reveal.
export function blindPickPanel(lobby: Lobby, playerId: string, names: CivNames, chosen?: string): Panel {
  const locked = lobby.picks.find((p) => p.player_id === playerId)?.leader;
  if (locked) {
    return { tone: 'success', surface: 'draft', title: pickTitle(lobby), subtitle: `Locked in: ${plainNameOf(names, locked)}. Revealed once every player has locked in.` };
  }
  const pool = lobby.pools.find((p) => p.player_id === playerId)?.leaders ?? [];
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId('lobby', VERB.picked, lobby.id))
    .setPlaceholder('Your leader')
    .addOptions(
      pool.map((token) => {
        const emoji = portraitOf(names, token);
        return { label: fit(plainNameOf(names, token), 100), value: token, default: token === chosen, ...(emoji ? { emoji } : {}) };
      }),
    );
  const lockIn = button(lobby, VERB.lockIn, chosen ? `Lock in ${fit(plainNameOf(names, chosen), 60)}` : 'Lock in', ButtonStyle.Success, ...(chosen ? [chosen] : [])).setDisabled(!chosen);
  return {
    tone: 'info',
    surface: 'draft',
    title: pickTitle(lobby),
    subtitle: closes(lobby, 'locked in'),
    actions: [row(menu), row(lockIn)],
  };
}

// The DM once the picks are revealed.
export function blindClosedPanel(lobby: Lobby, playerId: string, names: CivNames): Panel {
  const pick = lobby.picks.find((p) => p.player_id === playerId);
  const yours = pick ? `${plainNameOf(names, pick.leader)}${pick.by === 'auto' ? ', an auto pick' : ''}` : 'none';
  return { tone: 'muted', surface: 'draft', title: pickTitle(lobby), subtitle: lobby.status === 'done' ? `Revealed. You play ${yours}.` : 'Closed: the lobby was cancelled.' };
}
