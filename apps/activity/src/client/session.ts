import type { TokenStore } from './transport/client.js';
import { devToken } from './platform/browser.js';
import { authorizeCode } from './platform/discord.js';
import type { Runtime } from './platform/runtime.js';

const KEY = 'cpl:session';

// sessionStorage only, per C9. A tab closing ends the session.
export const store: TokenStore = {
  get: () => sessionStorage.getItem(KEY),
  set: (token) => sessionStorage.setItem(KEY, token),
};

type Minted = { token: string; expires_at: string; user: { id: string; username: string } };

async function mint(apiBase: string, code: string, lobbyId: string | null): Promise<string> {
  const res = await fetch(`${apiBase}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, ...(lobbyId ? { lobby_id: lobbyId } : {}) }),
  });
  if (!res.ok) throw new Error(`session ${res.status}`);
  const body = (await res.json()) as Minted;
  store.set(body.token);
  return body.token;
}

// The one place a session is obtained. Also what ApiClient calls to re-mint.
export function establish(runtime: Runtime, clientId: string): () => Promise<string> {
  return async () => {
    if (runtime.surface === 'browser') {
      const token = devToken(window.location) ?? store.get();
      if (!token) throw new Error('no session: browser surface needs ?token= in dev');
      store.set(token);
      return token;
    }
    return mint(runtime.apiBase, await authorizeCode(clientId), runtime.lobbyId);
  };
}
