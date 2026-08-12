import client, { initClient } from './client.js';
import { config } from './config.js';
import { stopJobs } from './jobs/index.js';

async function main(): Promise<void> {
  try {
    console.log(`⚙️ Starting application in ${config.env} mode...`);
    await initClient();

    await client.login(config.discord.token);
    console.log(`✅ Discord client ready as ${client.user?.tag ?? 'Unknown'}`);
  } catch (error) {
    console.error('Fatal error starting app:', error);
    process.exit(1);
  }
}

void main();

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  try {
    console.log(`🛑 Received ${signal}. Shutting down gracefully...`);
    stopJobs();

    const forceExitTimer = setTimeout(() => {
      console.error('🛑 Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);

    try {
      client.destroy();
      console.log('🔴 Discord client destroyed.');
    } finally {
      clearTimeout(forceExitTimer);
    }

    process.exit(0);
  } catch (e) {
    console.error('Error during shutdown:', e);
    process.exit(1);
  }
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});
