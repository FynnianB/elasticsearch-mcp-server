import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchService } from '../services/elasticsearchService.js';
import { ConfigManager } from '../config/configManager.js';
import logger from '../logger.js';

const testConnectionSchema = z.object({
  environment: z
    .string()
    .optional()
    .describe('The environment to test (optional, uses team default if not specified)'),
});

function createTestConnectionHandler(teamId: string) {
  return async function testConnectionHandler(
    params: z.infer<typeof testConnectionSchema>
  ): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    try {
      const configManager = new ConfigManager();
      const elasticsearchService = new ElasticsearchService(configManager);

      // Validate team exists
      const teamConfig = configManager.getTeamConfig(teamId);
      const environment = params.environment || teamConfig.defaultEnvironment;

      const isConnected = await elasticsearchService.testConnection(teamId, params.environment);

      logger.info(
        `Connection test for team ${teamId}, environment ${environment}: ${isConnected ? 'SUCCESS' : 'FAILED'}`
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                teamId: teamId,
                environment: environment,
                connected: isConnected,
                message: isConnected
                  ? `Successfully connected to Elasticsearch for team ${teamId} in ${environment}`
                  : `Failed to connect to Elasticsearch for team ${teamId} in ${environment}`,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Error in test connection tool:', error);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  };
}

export function registerTool(mcpServer: McpServer, teamId?: string): void {
  if (!teamId) {
    throw new Error('Team ID is required for test connection tool');
  }

  mcpServer.tool(
    'test_connection',
    'Test the Elasticsearch connection for the configured team and environment',
    testConnectionSchema.shape,
    createTestConnectionHandler(teamId)
  );
}
