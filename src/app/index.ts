import client, { initClient } from './client.js';
import { config } from '../core/config/index.js';
import { stopJobs } from '../core/scheduling.js';
import { error as logError, log as logInfo } from '../core/logging.js';

async function main(): Promise<void> {
  try {
    logInfo(`⚙️ Starting application in ${config.env} mode...`);
    await initClient();

    await client.login(config.discord.token);
    logInfo(`✅ Discord client ready as ${client.user?.tag ?? 'Unknown'}`);
  } catch (error) {
    logError('Fatal error starting app:', error);
    process.exit(1);
  }
}

void main();

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  try {
    logInfo(`🛑 Received ${signal}. Shutting down gracefully...`);
    stopJobs();

    const forceExitTimer = setTimeout(() => {
      logError('🛑 Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);

    try {
      client.destroy();
      logInfo('🔴 Discord client destroyed.');
    } finally {
      clearTimeout(forceExitTimer);
    }

    process.exit(0);
  } catch (e) {
    logError('Error during shutdown:', e);
    process.exit(1);
  }
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logError('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  logError('Uncaught exception:', err);
});
