import { config } from './config.js';
import { listen } from './server.js';

listen(
  {
    upstream: { baseUrl: config.coreApiUrl, bearer: config.coreApiToken },
    sessionSigningKey: config.sessionSigningKey,
  },
  config.port,
  config.env,
);
