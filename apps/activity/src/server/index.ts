import { log } from './log.js';
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

// Last resort, not a strategy: every dispatch already catches its own
// rejection. Anything that reaches here is logged and, for an exception,
// ends the process so systemd restarts it clean.
process.on('unhandledRejection', (reason) => {
  log.error('unhandled rejection', reason instanceof Error ? reason.stack ?? reason.message : reason);
});
process.on('uncaughtException', (error) => {
  log.error('uncaught exception, exiting', error.stack ?? error.message);
  process.exit(1);
});
