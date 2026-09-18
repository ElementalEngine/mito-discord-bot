import { useEffect, useRef, useState } from 'react';

import { type LobbyDoc, nameOf } from '../model.js';
import { Button, Panel, Screen } from '../ui/index.js';
import { channelName } from '../platform/discord.js';
import type { ApiClient } from '../transport/client.js';

type Props = {
  api: ApiClient;
  onOpen: (lobbyId: string) => void;
  inDiscord: boolean;
  channelId: string | null;
};

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID as string;

// The launcher path: every open lobby in the guild, with the voice channel
// a player has to be in to take a seat.
export function Dashboard({ api, onOpen, inDiscord, channelId }: Props) {
  const [lobbies, setLobbies] = useState<LobbyDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const scoped = channelId ? `/lobbies?channel_id=${encodeURIComponent(channelId)}` : '/lobbies';
    api
      .request<LobbyDoc[]>('GET', scoped)
      .then((reply) => {
        const here = reply.body ?? [];
        if (channelId && here.length === 1 && !jumped.current) {
          jumped.current = true;

          return onOpen(here[0]!._id);
        }
        if (channelId && here.length === 0) {
          return api
            .request<LobbyDoc[]>('GET', '/lobbies')
            .then((all) => setLobbies(all.body ?? []));
        }
        setLobbies(here);

        return undefined;
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [api, channelId, onOpen]);

  const jumped = useRef(false);

  const [voiceNames, setVoiceNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!inDiscord) return;
    const ids = [...new Set((lobbies ?? []).map((l) => l.voice_channel_id))];
    let live = true;
    void Promise.all(ids.map(async (id) => [id, await channelName(CLIENT_ID, id)] as const)).then((pairs) => {
      if (live) setVoiceNames(Object.fromEntries(pairs));
    });

    return () => {
      live = false;
    };
  }, [lobbies, inDiscord]);

  if (error) return <Screen title="Lobbies"><Panel className="text-sm text-danger">{error}</Panel></Screen>;
  if (lobbies === null) return <Screen title="Lobbies"><p className="text-sm text-muted">Loading…</p></Screen>;
  if (lobbies.length === 0) return <Screen title="Lobbies"><Panel className="py-6 text-center text-sm text-muted">No open lobbies. Start one with /lobby create.</Panel></Screen>;

  return (
    <Screen title="OPEN LOBBIES" meta={`${lobbies.length} in this guild`}>
      {lobbies.map((lobby) => {
        const host = lobby.seats.find((x) => x.discord_id === lobby.host_discord_id);

        return (
          <Panel key={lobby._id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="font-semibold">
                {lobby.edition.toUpperCase()} {lobby.game_type}
                <span className="ml-2 text-xs font-normal text-muted">
                  {lobby.seats.length}/{lobby.seat_count} seated · {lobby.phase}
                </span>
              </p>
              <p className="text-xs text-muted">
                host {nameOf(host)} · 🔊 {voiceNames[lobby.voice_channel_id] ?? lobby.voice_channel_id}
              </p>
              {lobby.host_rules && <p className="mt-1 truncate text-xs text-muted">{lobby.host_rules}</p>}
            </div>
            <Button variant="primary" onClick={() => onOpen(lobby._id)}>Open</Button>
          </Panel>
        );
      })}
    </Screen>
  );
}
