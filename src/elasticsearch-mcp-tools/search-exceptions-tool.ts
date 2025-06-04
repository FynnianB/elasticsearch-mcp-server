import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchService } from '../services/elasticsearchService.js';
import { ConfigManager } from '../config/configManager.js';
import logger from '../logger.js';

// Helper function to extract key terms from exception messages
function extractKeyTerms(message: string): string[] {
  // Remove common words and extract meaningful terms
  const stopWords = new Set([
    'the',
    'is',
    'at',
    'of',
    'on',
    'in',
    'to',
    'for',
    'and',
    'or',
    'but',
    'be',
    'been',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'should',
    'could',
    'can',
    'may',
    'might',
    'must',
    'shall',
  ]);

  return message
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Remove special characters
    .split(/\s+/)
    .filter((term: string) => term.length > 2 && !stopWords.has(term))
    .filter((term: string, index: number, arr: string[]) => arr.indexOf(term) === index) // Remove duplicates
    .slice(0, 5); // Take top 5 terms
}

const searchExceptionsSchema = z.object({
  environment: z
    .string()
    .optional()
    .describe('The environment to search in (optional, uses team default if not specified)'),
  message: z.string().optional().describe('Filter by exception message content'),
  service: z.string().optional().describe('Filter by service name'),
  severity: z.string().optional().describe('Filter by log severity level'),
  timeRange: z
    .object({
      start: z.string().describe('Start time in ISO format'),
      end: z.string().describe('End time in ISO format'),
    })
    .optional()
    .describe('Time range for the search (optional, defaults to last 24 hours)'),
  query: z.string().optional().describe('Search term for exception message or stack trace'),
  timeframe: z
    .enum(['1h', '6h', '12h', '24h', '7d'])
    .optional()
    .describe('Alternative to timeRange: predefined time frame'),
  limit: z.number().min(1).max(100).default(20).describe('Number of results to return'),
  sortByFrequency: z
    .boolean()
    .default(false)
    .describe('Sort results by frequency (most frequent first)'),
  smartSearch: z
    .boolean()
    .default(true)
    .describe('Use smart search strategy that tries multiple approaches to find exceptions'),
});

function createSearchExceptionsHandler(teamId: string) {
  return async function searchExceptionsHandler(
    params: z.infer<typeof searchExceptionsSchema>
  ): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    try {
      const configManager = new ConfigManager();
      const elasticsearchService = new ElasticsearchService(configManager);

      // Validate team exists
      const teamConfig = configManager.getTeamConfig(teamId);

      // Check if operation is allowed for this team
      if (
        teamConfig.allowedOperations &&
        !teamConfig.allowedOperations.includes('search_exceptions')
      ) {
        throw new Error(`Operation 'search_exceptions' not allowed for team '${teamId}'`);
      }

      let results;

      if (params.smartSearch && (params.message || params.query)) {
        // Smart search: try multiple search strategies in parallel
        const searchTerm = params.message || params.query!;
        const searchPromises = [];

        // Strategy 1: Exact phrase search
        searchPromises.push(
          elasticsearchService.searchExceptions(teamId, {
            ...params,
            message: `"${searchTerm}"`,
          })
        );

        // Strategy 2: Key terms search (extract important words)
        const keyTerms = extractKeyTerms(searchTerm);
        if (keyTerms.length > 0) {
          searchPromises.push(
            elasticsearchService.searchExceptions(teamId, {
              ...params,
              message: keyTerms.join(' '),
            })
          );
        }

        // Strategy 3: Fuzzy search for individual important words
        const importantWords = keyTerms.filter(term => term.length > 4);
        if (importantWords.length > 0) {
          searchPromises.push(
            elasticsearchService.searchExceptions(teamId, {
              ...params,
              message: importantWords[0], // Most important word
            })
          );
        }

        // Execute all searches in parallel
        const allResults = await Promise.allSettled(searchPromises);

        // Combine and deduplicate results
        const combinedResults = new Map();
        allResults
          .filter(result => result.status === 'fulfilled')
          .forEach((result: any) => {
            result.value.forEach((item: any) => {
              if (!combinedResults.has(item.id)) {
                combinedResults.set(item.id, item);
              }
            });
          });

        results = Array.from(combinedResults.values()).slice(0, params.limit);
      } else {
        // Standard search
        results = await elasticsearchService.searchExceptions(teamId, {
          environment: params.environment,
          message: params.message || params.query,
          service: params.service,
          severity: params.severity,
          timeRange: params.timeRange,
          timeframe: params.timeframe,
          limit: params.limit,
          sortByFrequency: params.sortByFrequency,
        });
      }

      logger.info(`Found ${results.length} exceptions for team ${teamId}`);

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
                sortedByFrequency: params.sortByFrequency,
                results: results.map(result => ({
                  id: result.id,
                  timestamp: result.timestamp,
                  message: result.message,
                  level: result.level,
                  service: result.service,
                  environment: result.environment,
                  stackTrace: result.stack_trace,
                  tags: result.tags,
                  index: result.index,
                  count: result.count, // for frequency sorting
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Error in search exceptions tool:', error);

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
    throw new Error('Team ID is required for search exceptions tool');
  }

  mcpServer.tool(
    'search_exceptions',
    'Search for exceptions in Elasticsearch for the configured team and environment',
    searchExceptionsSchema.shape,
    createSearchExceptionsHandler(teamId)
  );
}
