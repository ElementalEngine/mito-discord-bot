import { test } from 'node:test';
import assert from 'node:assert/strict';

import { advanceLobby } from './lobby-vote.service.js';
import { advanceVote } from './vote.service.js';

const past = () => new Date(Date.now() - 5_000).toISOString();
const players = [{ discord_id: '100', team: null }, { discord_id: '200', team: null }];
const pools = players.map((p) => ({ player_id: p.discord_id, team: null, leaders: ['LEADER_A'], civs: [] }));
const civData = { edition: 'civ6', leader_data_version: 1, leaders: [{ token: 'LEADER_A', name: 'A', display: 'Abe' }], civs: [] };
const lost = () => Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));

// A channel that records where it posts, what, and what it deletes.
function client(posted: string[], deleted: string[], sent: string[] = []) {
  const channel = (id: string) => ({
    id,
    isSendable: () => true,
    send: async (message: unknown) => (posted.push(id), sent.push(JSON.stringify(message)), { id: `${id}-m`, delete: async () => undefined }),
    bulkDelete: async (ids: string[]) => void deleted.push(...ids),
    messages: { cache: new Map(), fetch: async () => ({ reactions: { cache: new Map() } }), delete: async (m: string) => void deleted.push(m), edit: async () => ({}) },
  });
  return { channels: { fetch: async (id: string) => channel(id) } } as never;
}

const lobbyAt = (status: string, phase: string) => ({
  id: 'L1', code: 'ABC', guild_id: '1', channel_id: 'CH', message_id: 'POST', host_id: '100', status, phase,
  deadline: status === 'open' ? past() : null, shape: 'ffa-8', mode: 'ffa', seats: 8, teams: 0, lfg: false,
  steam_link: null, message: null, draft_mode: phase === 'picking' ? 'blind' : 'standard', settings: [], bans: [], players,
  pools, picks: [], cancel_reason: null, updated_at: past(), vote: { channel_id: 'VC', messages: { status: '11' }, finished: [] },
});

const voteAt = (status: string, phase = 'picking') => ({
  id: 'V1', code: 'XYZ', guild_id: '1', channel_id: 'VC', host_id: '100', edition: 'civ6', mode: 'ffa', age: null, status,
  phase, deadline: status === 'open' ? past() : null, draft_mode: 'blind', teams: 0, players, pools, picks: [],
  settings: [], bans: [], cancel_reason: null, updated_at: past(), vote: { channel_id: 'VC', messages: { status: '11' }, finished: [] },
});

// The first read finds the step due; later reads find it landed.
const reads = <T>(first: T, then: T) => {
  let n = 0;
  return async () => (n++ === 0 ? first : then);
};

test("a lobby's tally that landed with its answer lost still posts the draft", async () => {
  const [posted, deleted]: string[][] = [[], []];
  const api = { lobby: reads(lobbyAt('open', 'voting'), lobbyAt('done', 'voting')), lobbySettings: async () => [], getCivData: async () => civData, tallyVote: lost };
  await advanceLobby(client(posted, deleted), 'L1', api as never);
  assert.ok(posted.includes('VC') && deleted.includes('11'));
});

test("a lobby's blind picks revealed with the answer lost still post the draft", async () => {
  const [posted, deleted]: string[][] = [[], []];
  const api = { lobby: reads(lobbyAt('open', 'picking'), lobbyAt('done', 'picking')), lobbySettings: async () => [], getCivData: async () => civData, revealPicks: lost };
  await advanceLobby(client(posted, deleted), 'L1', api as never);
  assert.ok(posted.includes('VC') && deleted.includes('11'));
});

test("a vote's blind picks revealed with the answer lost still post the draft", async () => {
  const [posted, deleted]: string[][] = [[], []];
  const api = { vote: reads(voteAt('open'), voteAt('done')), lobbySettings: async () => [], getCivData: async () => civData, revealVotePicks: lost };
  await advanceVote(client(posted, deleted), 'V1', api as never);
  assert.ok(posted.includes('VC') && deleted.includes('11'));
});

test('a vote a player left unfinished closes, cancelling a lobby, and says so where it ran', async () => {
  const [posted, deleted, sent]: string[][] = [[], [], []];
  const inactive = { status: 'cancelled', cancel_reason: 'inactive', deadline: null };
  const lobbyApi = { lobby: async () => lobbyAt('open', 'voting'), lobbySettings: async () => [], getCivData: async () => civData, tallyVote: async () => ({ ...lobbyAt('open', 'voting'), ...inactive }) };
  await advanceLobby(client(posted, deleted, sent), 'L1', lobbyApi as never);
  assert.deepEqual(posted, ['VC']);
  assert.ok(deleted.includes('11') && deleted.includes('POST'));
  const voteApi = { vote: async () => voteAt('open', 'voting'), lobbySettings: async () => [], getCivData: async () => civData, tallyVoteBallot: async () => ({ ...voteAt('open', 'voting'), ...inactive }) };
  await advanceVote(client(posted, deleted, sent), 'V1', voteApi as never);
  assert.deepEqual(posted, ['VC', 'VC']);
  assert.ok(sent[0]?.includes('the lobby was cancelled') && sent[1]?.includes('no draft was dealt'));
  assert.ok(sent.every((s) => s.includes('Not finished') && s.includes('<@100>') && s.includes('<@200>')));
});

test('a step whose answer is lost and that did not land is still an error', async () => {
  const api = { lobby: reads(lobbyAt('open', 'voting'), lobbyAt('open', 'voting')), lobbySettings: async () => [], getCivData: async () => civData, tallyVote: lost };
  await assert.rejects(advanceLobby(client([], []), 'L1', api as never), { name: 'TimeoutError' });
});
