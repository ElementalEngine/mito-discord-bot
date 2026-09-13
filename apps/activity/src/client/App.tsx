import { useEffect, useMemo, useState } from 'react';

import { ApiClient } from './transport/client.js';
import { detect } from './platform/runtime.js';
import { establish, store } from './session.js';

type Boot = { state: 'booting' } | { state: 'ready'; api: ApiClient } | { state: 'failed'; reason: string };

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID as string;

export function App() {
  const runtime = useMemo(() => detect(window.location), []);
  const [boot, setBoot] = useState<Boot>({ state: 'booting' });

  useEffect(() => {
    const reauthorize = establish(runtime, CLIENT_ID);
    reauthorize()
      .then(() => setBoot({ state: 'ready', api: new ApiClient(runtime.apiBase, store, reauthorize) }))
      .catch((error: unknown) => setBoot({ state: 'failed', reason: error instanceof Error ? error.message : String(error) }));
  }, [runtime]);

  if (boot.state === 'booting') return <main>Connecting…</main>;
  if (boot.state === 'failed') return <main>Could not connect: {boot.reason}</main>;
  return (
    <main>
      <p>
        Connected via {runtime.surface}. {runtime.lobbyId ? `Lobby ${runtime.lobbyId}` : 'No lobby — dashboard'}
      </p>
    </main>
  );
}
