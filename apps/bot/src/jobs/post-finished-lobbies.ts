import type { Client } from 'discord.js';

import { ApiClient } from '../api/index.js';
import type { LobbyDocument } from '../api/types.js';
import { config } from '../config.js';
import { buildLobbyCompleteEmbed, type CivNames, civNamesOf } from '../ui/embeds/lobby.js';
import { log } from '../utils/log.js';

const INTERVAL_MS = 15_000;
const MAX_PER_TICK = 10;

// Fetched only when there is a lobby to post, once per edition per tick. A
// summary with token names beats no summary, so a failure does not block it.
async function namesFor(api: ApiClient, edition: LobbyDocument['edition'], seen: Map<string, CivNames>): Promise<CivNames> {
  const known = seen.get(edition);
  if (known) return known;
  const names = await api.getCivData(edition).then(civNamesOf).catch((error: unknown) => {
    log.warn('civ-data unavailable, posting token names', edition, error instanceof Error ? error.message : error);
    return new Map() as CivNames;
  });
  seen.set(edition, names);
  return names;
}

// Mite polls core-api for finished lobbies nobody has posted (P4: no
// inbound listener on the bot). claim-post hands each one over exactly
// once, so a lobby is posted once even if two ticks overlap.
async function postFinishedLobbies(client: Client, api: ApiClient): Promise<void> {
  const seen = new Map<string, CivNames>();
  for (let i = 0; i < MAX_PER_TICK; i += 1) {
    const lobby = await api.claimLobbyPost(config.discord.guildId);
    if (!lobby) return;
    const channel = await client.channels.fetch(lobby.channel_id).catch(() => null);
    if (!channel?.isSendable()) {
      log.warn('finished lobby has no sendable channel', lobby._id, lobby.channel_id);
      continue;
    }
    const names = lobby.phase === 'complete' ? await namesFor(api, lobby.edition, seen) : undefined;
    await channel.send({ embeds: [buildLobbyCompleteEmbed(lobby, names)] });
    log.info('posted finished lobby', lobby._id, lobby.phase);
  }
}

export function startPostFinishedLobbiesJob(client: Client): () => void {
  const api = new ApiClient();
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await postFinishedLobbies(client, api);
    } catch (error) {
      log.error('post-finished-lobbies tick failed', error);
    } finally {
      running = false;
    }
  };
  const interval = setInterval(() => void tick(), INTERVAL_MS);
  void tick();
  return () => clearInterval(interval);
}
