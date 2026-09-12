import { config } from './config.js';
import { listen } from './server.js';

listen(
  {
    upstream: { baseUrl: config.coreApiUrl, bearer: config.coreApiToken },
    discord: {
      baseUrl: 'https://discord.com/api/v10',
      clientId: config.discord.clientId,
      clientSecret: config.discord.clientSecret,
      guildId: config.discord.guildId,
    },
    sessionSigningKey: config.sessionSigningKey,
    staffRoleIds: config.staffRoleIds,
  },
  config.port,
  config.env,
);
