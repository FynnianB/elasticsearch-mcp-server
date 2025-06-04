import { startHttpServer, shutdownHttpServer } from './http-server.js';
import logger from './logger.js';

startHttpServer().catch(err => {
  logger.error('Failed to start JIRA MCP Server:', err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received. Shutting down gracefully...');
  shutdownHttpServer().finally(() => process.exit(0));
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received. Shutting down gracefully...');
  shutdownHttpServer().finally(() => process.exit(0));
});
