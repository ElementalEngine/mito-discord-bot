import { DiscordSDK } from '@discord/embedded-app-sdk';

// The only file that imports the SDK. It yields a code; the server does
// the rest, so no Discord access token ever exists in the browser.
let connected: Promise<DiscordSDK> | null = null;

function sdkOnce(clientId: string): Promise<DiscordSDK> {
  // One instance per frame: ready() is a handshake, not a getter.
  connected ??= (async () => {
    const sdk = new DiscordSDK(clientId);
    await sdk.ready();

    return sdk;
  })();

  return connected;
}

export async function authorizeCode(clientId: string): Promise<string> {
  const sdk = await sdkOnce(clientId);
  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify', 'guilds', 'guilds.members.read'],
  });

  return code;
}

// The channel's name, straight from Discord. Nothing is stored, so a rename
// is picked up on the next read; the id is the fallback when the call fails.
const names = new Map<string, Promise<string>>();

export function channelName(clientId: string, channelId: string): Promise<string> {
  const cached = names.get(channelId);
  if (cached) return cached;
  const lookup = sdkOnce(clientId)
    .then((sdk) => sdk.commands.getChannel({ channel_id: channelId }))
    .then((channel) => channel.name ?? channelId)
    .catch(() => channelId);
  names.set(channelId, lookup);

  return lookup;
}
