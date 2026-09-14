// Set once at bootstrap. The rest of the client branches on this, never on
// the SDK, which is confined to platform/discord.ts.
export type Surface = 'discord' | 'browser';

export type Runtime = Readonly<{
  surface: Surface;
  apiBase: string;
  lobbyId: string | null;
  channelId: string | null;
}>;

const LOBBY_ID = /^[0-9a-f]{24}$/;

export function detect(location: Location): Runtime {
  const params = new URLSearchParams(location.search);
  const surface: Surface = params.has('frame_id') ? 'discord' : 'browser';
  const custom = params.get('custom_id');
  const channelId = params.get('channel_id');
  return {
    surface,
    // Inside Discord every request to our own origin goes through the
    // discordsays proxy and needs the prefix; in a tab it does not.
    apiBase: surface === 'discord' ? '/.proxy/api' : '/api',
    channelId: channelId && /^\d{17,20}$/.test(channelId) ? channelId : null,
    lobbyId: custom && LOBBY_ID.test(custom) ? custom : null,
  };
}
