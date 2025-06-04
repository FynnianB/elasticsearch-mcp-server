import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchService } from '../services/elasticsearchService.js';
import { ConfigManager } from '../config/configManager.js';
import logger from '../logger.js';

const analyzeExceptionSchema = z.object({
  environment: z
    .string()
    .optional()
    .describe('The environment to search in (optional, uses team default if not specified)'),
  exceptionMessage: z.string().describe('The specific exception message to analyze'),
  timeframe: z
    .enum(['1h', '6h', '12h', '24h', '7d'])
    .default('24h')
    .describe('Time frame for the analysis'),
});

function createAnalyzeExceptionHandler(teamId: string) {
  return async function analyzeExceptionHandler(
    params: z.infer<typeof analyzeExceptionSchema>
  ): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    try {
      const configManager = new ConfigManager();
      const elasticsearchService = new ElasticsearchService(configManager);

      // Validate team exists
      const teamConfig = configManager.getTeamConfig(teamId);

      // Check if operation is allowed for this team
      if (
        teamConfig.allowedOperations &&
        !teamConfig.allowedOperations.includes('analyze_exception')
      ) {
        throw new Error(`Operation 'analyze_exception' not allowed for team '${teamId}'`);
      }

      const analysis = await elasticsearchService.analyzeSpecificException(
        teamId,
        params.exceptionMessage,
        params.timeframe,
        {
          environment: params.environment,
        }
      );

      logger.info(`Analyzed specific exception "${params.exceptionMessage}" for team ${teamId}`);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                teamId: teamId,
                environment: params.environment || teamConfig.defaultEnvironment,
                exceptionMessage: params.exceptionMessage,
                timeframe: params.timeframe,
                analysis: {
                  exception: {
                    message: analysis.exception.message,
                    service: analysis.exception.service,
                    stackTrace: analysis.exception.stackTrace,
                  },
                  frequency: {
                    total: analysis.frequency.total,
                    trend: analysis.frequency.trend,
                  },
                  affectedServices: analysis.affectedServices,
                  possibleCauses: analysis.possibleCauses,
                  suggestedSolutions: analysis.suggestedSolutions,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Error in analyze exception tool:', error);

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
    throw new Error('Team ID is required for analyze exception tool');
  }

  mcpServer.tool(
    'analyze_exception',
    'Analyze a specific exception in detail in Elasticsearch for the configured team and environment',
    analyzeExceptionSchema.shape,
    createAnalyzeExceptionHandler(teamId)
  );
}
