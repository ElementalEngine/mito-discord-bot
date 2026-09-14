// Set once at bootstrap. The rest of the client branches on this, never on
// the SDK, which is confined to platform/discord.ts.
export type Surface = 'discord' | 'browser';

export type Runtime = Readonly<{
  surface: Surface;
  apiBase: string;
  lobbyId: string | null;
  channelId: string | null;
  appearance: Readonly<{
    theme: 'dark' | 'light';
    fontScale: number;
    reducedMotion: boolean;
    highContrast: boolean;
  }>;
}>;

const LOBBY_ID = /^[0-9a-f]{24}$/;

export function detect(location: Location): Runtime {
  const params = new URLSearchParams(location.search);
  const surface: Surface = params.has('frame_id') ? 'discord' : 'browser';
  const custom = params.get('custom_id');
  const channelId = params.get('channel_id');
  const fontScale = Number(params.get('font_scale') ?? '100');
  return {
    surface,
    // Inside Discord every request to our own origin goes through the
    // discordsays proxy and needs the prefix; in a tab it does not.
    apiBase: surface === 'discord' ? '/.proxy/api' : '/api',
    channelId: channelId && /^\d{17,20}$/.test(channelId) ? channelId : null,
    appearance: {
      theme: params.get('theme') === 'light' ? 'light' : 'dark',
      fontScale: Number.isFinite(fontScale) ? Math.min(Math.max(fontScale, 50), 200) / 100 : 1,
      reducedMotion: params.get('reduced_motion') === 'true',
      highContrast: params.get('high_contrast') === 'true',
    },
    lobbyId: custom && LOBBY_ID.test(custom) ? custom : null,
  };
}
