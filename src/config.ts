import { z } from 'zod';
import { type ElasticsearchConfig, type HttpServerConfig } from './config.types.js';
import logger from './logger.js';
import path from 'path';

export class EnvironmentConfigError extends Error {
  public readonly fieldErrors: Record<string, string[] | undefined>;

  constructor(message: string, fieldErrors: Record<string, string[] | undefined>) {
    super(message);
    this.name = 'EnvironmentConfigError';
    this.fieldErrors = fieldErrors;
    Object.setPrototypeOf(this, EnvironmentConfigError.prototype);
  }
}

const envSchema = z.object({
  HTTP_PATH_PREFIX: z
    .string()
    .optional()
    .default('/')
    .describe('Optional path prefix for the HTTP server (defaults to /)'),
  TEAMS_CONFIG_PATH: z.string().optional().describe('Path to the teams configuration file'),
});

const parsedResult = envSchema.safeParse(process.env);

if (!parsedResult.success) {
  const fieldErrors = parsedResult.error.flatten().fieldErrors;
  const errorMessages = JSON.stringify(fieldErrors, null, 2);
  logger.error('Error validating environment variables:', errorMessages);

  throw new EnvironmentConfigError(`Invalid environment configuration`, fieldErrors);
}

const elasticsearchConfig: ElasticsearchConfig = {
  teamsConfigPath: parsedResult.data.TEAMS_CONFIG_PATH,
};

const httpServerConfig: HttpServerConfig = {
  ssePath: path.join(parsedResult.data.HTTP_PATH_PREFIX, '/sse'),
  messagesPath: path.join(parsedResult.data.HTTP_PATH_PREFIX, '/messages'),
  mcpPath: path.join(parsedResult.data.HTTP_PATH_PREFIX, '/mcp'),
};

export { elasticsearchConfig, httpServerConfig };
