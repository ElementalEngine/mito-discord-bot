import { useEffect, useMemo, useState } from 'react';

import { detect } from './platform/runtime.js';
import { Dashboard } from './screens/dashboard.js';
import { LobbyScreen } from './screens/lobby.js';
import { establish, store } from './session.js';
import { ApiClient } from './transport/client.js';
import { type Me, whoami } from './whoami.js';

type Boot = { state: 'booting' } | { state: 'ready'; api: ApiClient; me: Me } | { state: 'failed'; reason: string };

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID as string;

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return Object.prototype.toString.call(error);
  }
}

export function App() {
  const runtime = useMemo(() => detect(window.location), []);
  const [boot, setBoot] = useState<Boot>({ state: 'booting' });
  const [lobbyId, setLobbyId] = useState<string | null>(runtime.lobbyId);

  useEffect(() => {
    const reauthorize = establish(runtime, CLIENT_ID);
    reauthorize()
      .then((token) => {
        const me = whoami(token);
        if (!me) throw new Error('session payload unreadable');
        setBoot({ state: 'ready', api: new ApiClient(runtime.apiBase, store, reauthorize), me });
      })
      .catch((error: unknown) => setBoot({ state: 'failed', reason: describe(error) }));
  }, [runtime]);

  if (boot.state === 'booting') return <main>Connecting…</main>;
  if (boot.state === 'failed') return <main>Could not connect: {boot.reason}</main>;
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 12 }}>
      {lobbyId ? (
        <LobbyScreen api={boot.api} me={boot.me} lobbyId={lobbyId} onBack={() => setLobbyId(null)} />
      ) : (
        <Dashboard api={boot.api} onOpen={setLobbyId} />
      )}
    </main>
  );
}
