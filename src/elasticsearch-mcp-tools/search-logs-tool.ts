import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchService } from '../services/elasticsearchService.js';
import { ConfigManager } from '../config/configManager.js';
import logger from '../logger.js';

const searchLogsSchema = z.object({
  environment: z
    .string()
    .optional()
    .describe('The environment to search in (optional, uses team default if not specified)'),
  message: z.string().optional().describe('Filter by log message content'),
  service: z.string().optional().describe('Filter by service name'),
  timeRange: z
    .object({
      start: z.string().describe('Start time in ISO format'),
      end: z.string().describe('End time in ISO format'),
    })
    .optional()
    .describe('Time range for the search (optional, defaults to last 1 hour)'),
});

function createSearchLogsHandler(teamId: string) {
  return async function searchLogsHandler(
    params: z.infer<typeof searchLogsSchema>
  ): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    try {
      const configManager = new ConfigManager();
      const elasticsearchService = new ElasticsearchService(configManager);

      // Validate team exists
      const teamConfig = configManager.getTeamConfig(teamId);

      // Check if operation is allowed for this team
      if (teamConfig.allowedOperations && !teamConfig.allowedOperations.includes('search_logs')) {
        throw new Error(`Operation 'search_logs' not allowed for team '${teamId}'`);
      }

      const results = await elasticsearchService.searchLogs(teamId, {
        environment: params.environment,
        message: params.message,
        service: params.service,
        timeRange: params.timeRange,
      });

      logger.info(`Found ${results.length} log entries for team ${teamId}`);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                teamId: teamId,
                environment: params.environment || teamConfig.defaultEnvironment,
                totalResults: results.length,
                results: results.map(result => ({
                  id: result.id,
                  timestamp: result.timestamp,
                  message: result.message,
                  level: result.level,
                  service: result.service,
                  environment: result.environment,
                  tags: result.tags,
                  index: result.index,
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Error in search logs tool:', error);

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
    throw new Error('Team ID is required for search logs tool');
  }

  mcpServer.tool(
    'search_logs',
    'Search for logs in Elasticsearch for the configured team and environment',
    searchLogsSchema.shape,
    createSearchLogsHandler(teamId)
  );
}
