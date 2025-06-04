import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchService } from '../services/elasticsearchService.js';
import { ConfigManager } from '../config/configManager.js';
import logger from '../logger.js';

const analyzeTrendsSchema = z.object({
  environment: z
    .string()
    .optional()
    .describe('The environment to analyze (optional, uses team default if not specified)'),
  timeRange: z
    .object({
      start: z.string().describe('Start time in ISO format'),
      end: z.string().describe('End time in ISO format'),
    })
    .optional()
    .describe('Time range for the analysis (optional, defaults to last 7 days)'),
  timeframe: z
    .enum(['1h', '6h', '12h', '24h', '7d'])
    .default('24h')
    .describe('Alternative to timeRange: predefined time frame for trends analysis'),
  analysisType: z
    .enum(['exceptions', 'services', 'both'])
    .default('both')
    .describe('Type of analysis: exception trends, service trends, or both'),
  services: z
    .array(z.string())
    .optional()
    .describe('Optional: List of specific services to analyze'),
});

function createAnalyzeTrendsHandler(teamId: string) {
  return async function analyzeTrendsHandler(
    params: z.infer<typeof analyzeTrendsSchema>
  ): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    try {
      const configManager = new ConfigManager();
      const elasticsearchService = new ElasticsearchService(configManager);

      // Validate team exists
      const teamConfig = configManager.getTeamConfig(teamId);

      // Check if operation is allowed for this team
      if (
        teamConfig.allowedOperations &&
        !teamConfig.allowedOperations.includes('analyze_trends')
      ) {
        throw new Error(`Operation 'analyze_trends' not allowed for team '${teamId}'`);
      }

      let exceptionAnalysis = null;
      let serviceAnalysis = null;

      // Perform exception analysis if requested
      if (params.analysisType === 'exceptions' || params.analysisType === 'both') {
        exceptionAnalysis = await elasticsearchService.analyzeExceptions(teamId, {
          environment: params.environment,
          timeRange: params.timeRange,
        });
      }

      // Perform service trends analysis if requested
      if (params.analysisType === 'services' || params.analysisType === 'both') {
        const serviceTrends = await elasticsearchService.getServiceExceptionTrends(
          teamId,
          params.timeframe,
          {
            environment: params.environment,
          }
        );

        // Filter by specific services if provided
        const filteredTrends = params.services
          ? serviceTrends.filter(trend => params.services!.includes(trend.service))
          : serviceTrends;

        serviceAnalysis = {
          totalServices: filteredTrends.length,
          trends: filteredTrends.map(trend => ({
            service: trend.service,
            exceptionCount: trend.exceptionCount,
            trend: trend.trend,
            percentageChange: trend.percentageChange,
            topExceptions: trend.topExceptions.map(exc => ({
              message: exc.message,
              count: exc.count,
            })),
          })),
        };
      }

      logger.info(`Analyzed trends for team ${teamId}: ${params.analysisType}`);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                teamId: teamId,
                environment: params.environment || teamConfig.defaultEnvironment,
                analysisType: params.analysisType,
                timeframe: params.timeframe,
                timeRange: params.timeRange,
                services: params.services || 'all',
                exceptionAnalysis: exceptionAnalysis
                  ? {
                      totalCount: exceptionAnalysis.totalCount,
                      uniqueExceptions: exceptionAnalysis.uniqueExceptions,
                      topExceptions: exceptionAnalysis.topExceptions,
                      timeDistribution: exceptionAnalysis.timeDistribution,
                    }
                  : null,
                serviceAnalysis: serviceAnalysis,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Error in analyze trends tool:', error);

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
    throw new Error('Team ID is required for analyze trends tool');
  }

  mcpServer.tool(
    'analyze_trends',
    'Analyze exception patterns and service trends for the configured team and environment',
    analyzeTrendsSchema.shape,
    createAnalyzeTrendsHandler(teamId)
  );
}
