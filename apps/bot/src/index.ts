import client, { initClient } from './client.js';
import { config } from './config.js';
import { stopJobs } from './jobs/index.js';
import { log } from './utils/log.js';

async function main(): Promise<void> {
  try {
    log.info(`⚙️ Starting application in ${config.env} mode...`);
    await initClient();

    await client.login(config.discord.token);
    log.info(`✅ Discord client ready as ${client.user?.tag ?? 'Unknown'}`);
  } catch (error) {
    log.error('Fatal error starting app:', error);
    process.exit(1);
  }
}

void main();

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  try {
    log.info(`🛑 Received ${signal}. Shutting down gracefully...`);
    stopJobs();

    const forceExitTimer = setTimeout(() => {
      log.error('🛑 Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);

    try {
      client.destroy();
      log.info('🔴 Discord client destroyed.');
    } finally {
      clearTimeout(forceExitTimer);
    }

    process.exit(0);
  } catch (e) {
    log.error('Error during shutdown:', e);
    process.exit(1);
  }
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  log.error('Uncaught exception:', err);
});
