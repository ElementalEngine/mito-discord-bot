import { DiscordSDK } from '@discord/embedded-app-sdk';

// The only file that imports the SDK. It yields a code; the server does
// the rest, so no Discord access token ever exists in the browser.
export async function authorizeCode(clientId: string): Promise<string> {
  const sdk = new DiscordSDK(clientId);
  await sdk.ready();
  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify', 'guilds.members.read'],
  });
  return code;
}
