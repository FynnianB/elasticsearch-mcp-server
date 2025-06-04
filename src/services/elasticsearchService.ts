import { Client, ClientOptions } from '@elastic/elasticsearch';
import type {
  ElasticsearchEnvironmentConfig,
  ElasticsearchSearchResult,
  SearchFilters,
  ExceptionAnalysis,
  FrequentException,
  ExceptionByContext,
  SpecificExceptionAnalysis,
  ServiceExceptionTrend,
} from '../types.js';
import { ConfigManager } from '../config/configManager.js';
import logger from '../logger.js';
import { format, subDays } from 'date-fns';

export class ElasticsearchService {
  private clients: Map<string, Client> = new Map();
  private configManager: ConfigManager;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
  }

  private getClientKey(teamId: string, environment: string): string {
    return `${teamId}:${environment}`;
  }

  private createClient(config: ElasticsearchEnvironmentConfig): Client {
    const clientConfig: ClientOptions = {
      node: config.node,
      maxRetries: config.maxRetries || 3,
      requestTimeout: config.requestTimeout || 30000,
    };

    if (config.apiKey) {
      clientConfig.auth = {
        apiKey: config.apiKey,
      };
    } else if (config.username && config.password) {
      clientConfig.auth = {
        username: config.username,
        password: config.password,
      };
    }

    return new Client(clientConfig);
  }

  private getClient(teamId: string, environment?: string): Client {
    const teamConfig = this.configManager.getTeamConfig(teamId);
    const env = environment || teamConfig.defaultEnvironment;

    if (!env) {
      throw new Error(`No environment specified and no default environment for team ${teamId}`);
    }

    const envConfig = teamConfig.environments[env];
    if (!envConfig) {
      throw new Error(`Environment '${env}' not found for team '${teamId}'`);
    }

    const clientKey = this.getClientKey(teamId, env);

    if (!this.clients.has(clientKey)) {
      const client = this.createClient(envConfig);
      this.clients.set(clientKey, client);
      logger.info(`Created Elasticsearch client for team ${teamId}, environment ${env}`);
    }

    return this.clients.get(clientKey)!;
  }

  public async searchExceptions(
    teamId: string,
    filters: SearchFilters = {}
  ): Promise<ElasticsearchSearchResult[]> {
    const teamConfig = this.configManager.getTeamConfig(teamId);
    const client = this.getClient(teamId, filters.environment);

    const query: any = {
      bool: {
        must: [],
        filter: [],
      },
    };

    // Time range filter
    if (filters.timeRange) {
      query.bool.filter.push({
        range: {
          '@timestamp': {
            gte: filters.timeRange.start,
            lte: filters.timeRange.end,
          },
        },
      });
    } else {
      // Default to last 24 hours
      query.bool.filter.push({
        range: {
          '@timestamp': {
            gte: format(subDays(new Date(), 1), "yyyy-MM-dd'T'HH:mm:ss.SSSxxx"),
          },
        },
      });
    }

    // Message filter
    if (filters.message) {
      query.bool.must.push({
        multi_match: {
          query: filters.message,
          fields: ['message', 'error.message', 'exception.message'],
          type: 'best_fields',
        },
      });
    }

    // Severity filter
    if (filters.severity) {
      query.bool.filter.push({
        term: {
          'log.level': filters.severity.toLowerCase(),
        },
      });
    }

    // Service filter
    if (filters.service) {
      query.bool.filter.push({
        term: {
          'service.name': filters.service,
        },
      });
    }

    const searchParams = {
      index: teamConfig.indexPatterns.exceptions,
      body: {
        query,
        sort: [{ '@timestamp': { order: 'desc' } }],
        size: teamConfig.maxSearchResults || 50,
        _source: [
          '@timestamp',
          'message',
          'log.level',
          'service.name',
          'error.message',
          'error.stack_trace',
          'exception.message',
          'exception.stacktrace',
          'tags',
          'environment',
        ],
      },
    };

    try {
      const response = await client.search(searchParams);

      return response.hits.hits.map((hit: any) => ({
        id: hit._id,
        index: hit._index,
        timestamp: hit._source['@timestamp'],
        message:
          hit._source.message || hit._source['error.message'] || hit._source['exception.message'],
        level: hit._source['log.level'],
        service: hit._source['service.name'],
        environment: hit._source.environment,
        stack_trace: hit._source['error.stack_trace'] || hit._source['exception.stacktrace'],
        tags: hit._source.tags,
        fields: hit._source,
      }));
    } catch (error) {
      logger.error(`Error searching exceptions for team ${teamId}:`, error);
      throw new Error(
        `Failed to search exceptions: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  public async analyzeExceptions(
    teamId: string,
    filters: SearchFilters = {}
  ): Promise<ExceptionAnalysis> {
    const teamConfig = this.configManager.getTeamConfig(teamId);
    const client = this.getClient(teamId, filters.environment);

    const query: any = {
      bool: {
        must: [],
        filter: [],
      },
    };

    // Time range filter
    if (filters.timeRange) {
      query.bool.filter.push({
        range: {
          '@timestamp': {
            gte: filters.timeRange.start,
            lte: filters.timeRange.end,
          },
        },
      });
    } else {
      // Default to last 7 days for analysis
      query.bool.filter.push({
        range: {
          '@timestamp': {
            gte: format(subDays(new Date(), 7), "yyyy-MM-dd'T'HH:mm:ss.SSSxxx"),
          },
        },
      });
    }

    const searchParams = {
      index: teamConfig.indexPatterns.exceptions,
      body: {
        query,
        size: 0,
        aggs: {
          total_count: {
            value_count: {
              field: '@timestamp',
            },
          },
          unique_exceptions: {
            cardinality: {
              field: 'error.message.keyword',
            },
          },
          top_exceptions: {
            terms: {
              field: 'error.message.keyword',
              size: 10,
            },
            aggs: {
              first_seen: {
                min: {
                  field: '@timestamp',
                },
              },
              last_seen: {
                max: {
                  field: '@timestamp',
                },
              },
              affected_services: {
                terms: {
                  field: 'service.name.keyword',
                  size: 10,
                },
              },
            },
          },
          time_distribution: {
            date_histogram: {
              field: '@timestamp',
              calendar_interval: '1h',
            },
          },
        },
      },
    };

    try {
      const response = await client.search(searchParams);
      const aggs = response.aggregations as any;

      return {
        totalCount: aggs.total_count.value,
        uniqueExceptions: aggs.unique_exceptions.value,
        topExceptions: aggs.top_exceptions.buckets.map((bucket: any) => ({
          message: bucket.key,
          count: bucket.doc_count,
          firstSeen: bucket.first_seen.value_as_string,
          lastSeen: bucket.last_seen.value_as_string,
          affectedServices: bucket.affected_services.buckets.map((service: any) => service.key),
        })),
        timeDistribution: aggs.time_distribution.buckets.map((bucket: any) => ({
          timestamp: bucket.key_as_string,
          count: bucket.doc_count,
        })),
      };
    } catch (error) {
      logger.error(`Error analyzing exceptions for team ${teamId}:`, error);
      throw new Error(
        `Failed to analyze exceptions: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  public async searchLogs(
    teamId: string,
    filters: SearchFilters = {}
  ): Promise<ElasticsearchSearchResult[]> {
    const teamConfig = this.configManager.getTeamConfig(teamId);
    const client = this.getClient(teamId, filters.environment);

    const indexPatterns = [
      ...teamConfig.indexPatterns.applications,
      ...(teamConfig.indexPatterns.logs || []),
    ];

    const query: any = {
      bool: {
        must: [],
        filter: [],
      },
    };

    // Time range filter
    if (filters.timeRange) {
      query.bool.filter.push({
        range: {
          '@timestamp': {
            gte: filters.timeRange.start,
            lte: filters.timeRange.end,
          },
        },
      });
    } else {
      // Default to last 1 hour for logs
      query.bool.filter.push({
        range: {
          '@timestamp': {
            gte: format(subDays(new Date(), 0.04), "yyyy-MM-dd'T'HH:mm:ss.SSSxxx"), // ~1 hour
          },
        },
      });
    }

    // Message filter
    if (filters.message) {
      query.bool.must.push({
        multi_match: {
          query: filters.message,
          fields: ['message', 'log.message'],
          type: 'best_fields',
        },
      });
    }

    // Service filter
    if (filters.service) {
      query.bool.filter.push({
        term: {
          'service.name': filters.service,
        },
      });
    }

    const searchParams = {
      index: indexPatterns,
      body: {
        query,
        sort: [{ '@timestamp': { order: 'desc' } }],
        size: teamConfig.maxSearchResults || 50,
        _source: ['@timestamp', 'message', 'log.level', 'service.name', 'tags', 'environment'],
      },
    };

    try {
      const response = await client.search(searchParams);

      return response.hits.hits.map((hit: any) => ({
        id: hit._id,
        index: hit._index,
        timestamp: hit._source['@timestamp'],
        message: hit._source.message || hit._source['log.message'],
        level: hit._source['log.level'],
        service: hit._source['service.name'],
        environment: hit._source.environment,
        tags: hit._source.tags,
        fields: hit._source,
      }));
    } catch (error) {
      logger.error(`Error searching logs for team ${teamId}:`, error);
      throw new Error(
        `Failed to search logs: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  public async testConnection(teamId: string, environment?: string): Promise<boolean> {
    try {
      const client = this.getClient(teamId, environment);
      const response = await client.ping();
      return response === true;
    } catch (error) {
      logger.error(`Connection test failed for team ${teamId}, environment ${environment}:`, error);
      return false;
    }
  }

  public async searchFrequentExceptions(
    teamId: string,
    timeframe: string = '24h',
    limit: number = 10,
    filters: SearchFilters = {}
  ): Promise<FrequentException[]> {
    const teamConfig = this.configManager.getTeamConfig(teamId);
    const client = this.getClient(teamId, filters.environment);

    // Convert timeframe to date range
    const timeRangeHours =
      {
        '1h': 1,
        '6h': 6,
        '12h': 12,
        '24h': 24,
        '7d': 168,
      }[timeframe] || 24;

    const now = new Date();
    const timeRangeStart = new Date(now.getTime() - timeRangeHours * 60 * 60 * 1000);

    const query: any = {
      bool: {
        must: [
          {
            range: {
              '@timestamp': {
                gte: format(timeRangeStart, "yyyy-MM-dd'T'HH:mm:ss.SSSxxx"),
                lte: format(now, "yyyy-MM-dd'T'HH:mm:ss.SSSxxx"),
              },
            },
          },
          {
            bool: {
              should: [
                { exists: { field: 'error.message' } },
                { exists: { field: 'exception.message' } },
                { term: { 'log.level': 'ERROR' } },
              ],
              minimum_should_match: 1,
            },
          },
        ],
        filter: [],
      },
    };

    // Apply service filter if provided
    if (filters.service) {
      query.bool.filter.push({
        term: {
          'service.name': filters.service,
        },
      });
    }

    const searchParams = {
      index: teamConfig.indexPatterns.exceptions,
      body: {
        query,
        size: 0,
        aggs: {
          frequent_exceptions: {
            terms: {
              field: 'error.message.keyword',
              size: limit,
            },
            aggs: {
              latest_occurrence: {
                top_hits: {
                  size: 1,
                  sort: [{ '@timestamp': { order: 'desc' } }],
                  _source: ['@timestamp', 'service.name', 'error.stack_trace'],
                },
              },
            },
          },
        },
      },
    };

    try {
      const response = await client.search(searchParams);
      const aggs = response.aggregations as any;

      const results: FrequentException[] = [];
      if (aggs.frequent_exceptions?.buckets) {
        for (const bucket of aggs.frequent_exceptions.buckets) {
          const latestHit = bucket.latest_occurrence.hits.hits[0];
          if (latestHit) {
            results.push({
              message: bucket.key,
              count: bucket.doc_count,
              service: latestHit._source['service.name'] || 'unknown',
              timestamp: latestHit._source['@timestamp'],
              stackTrace: latestHit._source['error.stack_trace'],
            });
          }
        }
      }

      return results;
    } catch (error) {
      logger.error(`Error searching frequent exceptions for team ${teamId}:`, error);
      throw new Error(
        `Failed to search frequent exceptions: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  public async searchExceptionsByContext(
    teamId: string,
    query: string,
    timeframe: string = '24h',
    filters: SearchFilters = {}
  ): Promise<ExceptionByContext[]> {
    const teamConfig = this.configManager.getTeamConfig(teamId);
    const client = this.getClient(teamId, filters.environment);

    // Convert timeframe to date range
    const timeRangeHours =
      {
        '1h': 1,
        '6h': 6,
        '12h': 12,
        '24h': 24,
        '7d': 168,
      }[timeframe] || 24;

    const now = new Date();
    const timeRangeStart = new Date(now.getTime() - timeRangeHours * 60 * 60 * 1000);

    const searchQuery: any = {
      bool: {
        must: [
          {
            range: {
              '@timestamp': {
                gte: format(timeRangeStart, "yyyy-MM-dd'T'HH:mm:ss.SSSxxx"),
                lte: format(now, "yyyy-MM-dd'T'HH:mm:ss.SSSxxx"),
              },
            },
          },
          {
            multi_match: {
              query: query,
              fields: [
                'error.message',
                'exception.message',
                'error.stack_trace',
                'exception.stacktrace',
                'message',
              ],
              type: 'best_fields',
            },
          },
        ],
        filter: [],
      },
    };

    // Apply service filter if provided
    if (filters.service) {
      searchQuery.bool.filter.push({
        term: {
          'service.name': filters.service,
        },
      });
    }

    const searchParams = {
      index: teamConfig.indexPatterns.exceptions,
      body: {
        query: searchQuery,
        sort: [{ '@timestamp': { order: 'desc' } }],
        size: 20,
        _source: [
          '@timestamp',
          'error.message',
          'exception.message',
          'service.name',
          'error.stack_trace',
          'exception.stacktrace',
          'message',
        ],
      },
    };

    try {
      const response = await client.search(searchParams);

      return response.hits.hits.map((hit: any) => ({
        message:
          hit._source['error.message'] ||
          hit._source['exception.message'] ||
          hit._source.message ||
          'Unknown error',
        service: hit._source['service.name'] || 'unknown',
        timestamp: hit._source['@timestamp'],
        stackTrace: hit._source['error.stack_trace'] || hit._source['exception.stacktrace'],
      }));
    } catch (error) {
      logger.error(`Error searching exceptions by context for team ${teamId}:`, error);
      throw new Error(
        `Failed to search exceptions by context: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  public async analyzeSpecificException(
    teamId: string,
    exceptionMessage: string,
    timeframe: string = '24h',
    filters: SearchFilters = {}
  ): Promise<SpecificExceptionAnalysis> {
    const teamConfig = this.configManager.getTeamConfig(teamId);
    const client = this.getClient(teamId, filters.environment);

    // Convert timeframe to date range
    const timeRangeHours =
      {
        '1h': 1,
        '6h': 6,
        '12h': 12,
        '24h': 24,
        '7d': 168,
      }[timeframe] || 24;

    const now = new Date();
    const timeRangeStart = new Date(now.getTime() - timeRangeHours * 60 * 60 * 1000);

    const query: any = {
      bool: {
        must: [
          {
            range: {
              '@timestamp': {
                gte: format(timeRangeStart, "yyyy-MM-dd'T'HH:mm:ss.SSSxxx"),
                lte: format(now, "yyyy-MM-dd'T'HH:mm:ss.SSSxxx"),
              },
            },
          },
          {
            multi_match: {
              query: exceptionMessage,
              fields: ['error.message', 'exception.message', 'message'],
              type: 'phrase',
            },
          },
        ],
      },
    };

    const searchParams = {
      index: teamConfig.indexPatterns.exceptions,
      body: {
        query,
        size: 100,
        sort: [{ '@timestamp': { order: 'desc' } }],
        _source: [
          '@timestamp',
          'error.message',
          'exception.message',
          'service.name',
          'error.stack_trace',
          'exception.stacktrace',
          'message',
        ],
        aggs: {
          affected_services: {
            terms: {
              field: 'service.name.keyword',
              size: 10,
            },
          },
          time_distribution: {
            date_histogram: {
              field: '@timestamp',
              calendar_interval: '1h',
            },
          },
        },
      },
    };

    try {
      const response = await client.search(searchParams);
      const aggs = response.aggregations as any;
      const hits = response.hits.hits;

      if (hits.length === 0) {
        throw new Error(`No exceptions found matching: ${exceptionMessage}`);
      }

      const latestException = hits[0]._source as any;
      const affectedServices = aggs.affected_services.buckets.map((bucket: any) => bucket.key);

      // Determine trend based on time distribution
      const timeDistribution = aggs.time_distribution.buckets;
      const trend = timeDistribution.length > 1 ? this.determineTrend(timeDistribution) : 'stable';

      // Handle total count properly for different Elasticsearch versions
      const totalHits =
        typeof response.hits.total === 'number'
          ? response.hits.total
          : (response.hits.total as any)?.value || 0;

      return {
        exception: {
          message:
            latestException['error.message'] ||
            latestException['exception.message'] ||
            latestException.message ||
            exceptionMessage,
          service: latestException['service.name'] || 'unknown',
          stackTrace:
            latestException['error.stack_trace'] || latestException['exception.stacktrace'],
        },
        frequency: {
          total: totalHits,
          trend,
        },
        affectedServices,
        possibleCauses: this.generatePossibleCauses(exceptionMessage),
        suggestedSolutions: this.generateSuggestedSolutions(exceptionMessage),
      };
    } catch (error) {
      logger.error(`Error analyzing specific exception for team ${teamId}:`, error);
      throw new Error(
        `Failed to analyze specific exception: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  public async getServiceExceptionTrends(
    teamId: string,
    timeframe: string = '24h',
    filters: SearchFilters = {}
  ): Promise<ServiceExceptionTrend[]> {
    const teamConfig = this.configManager.getTeamConfig(teamId);
    const client = this.getClient(teamId, filters.environment);

    // Convert timeframe to date range
    const timeRangeHours =
      {
        '1h': 1,
        '6h': 6,
        '12h': 12,
        '24h': 24,
        '7d': 168,
      }[timeframe] || 24;

    const now = new Date();
    const timeRangeStart = new Date(now.getTime() - timeRangeHours * 60 * 60 * 1000);
    const midPoint = new Date(
      timeRangeStart.getTime() + (now.getTime() - timeRangeStart.getTime()) / 2
    );

    const query: any = {
      bool: {
        must: [
          {
            range: {
              '@timestamp': {
                gte: format(timeRangeStart, "yyyy-MM-dd'T'HH:mm:ss.SSSxxx"),
                lte: format(now, "yyyy-MM-dd'T'HH:mm:ss.SSSxxx"),
              },
            },
          },
          {
            bool: {
              should: [
                { exists: { field: 'error.message' } },
                { exists: { field: 'exception.message' } },
                { term: { 'log.level': 'ERROR' } },
              ],
              minimum_should_match: 1,
            },
          },
        ],
      },
    };

    const searchParams = {
      index: teamConfig.indexPatterns.exceptions,
      body: {
        query,
        size: 0,
        aggs: {
          services: {
            terms: {
              field: 'service.name.keyword',
              size: 10,
            },
            aggs: {
              total_exceptions: {
                value_count: {
                  field: '@timestamp',
                },
              },
              first_half: {
                filter: {
                  range: {
                    '@timestamp': {
                      gte: format(timeRangeStart, "yyyy-MM-dd'T'HH:mm:ss.SSSxxx"),
                      lt: format(midPoint, "yyyy-MM-dd'T'HH:mm:ss.SSSxxx"),
                    },
                  },
                },
              },
              second_half: {
                filter: {
                  range: {
                    '@timestamp': {
                      gte: format(midPoint, "yyyy-MM-dd'T'HH:mm:ss.SSSxxx"),
                      lte: format(now, "yyyy-MM-dd'T'HH:mm:ss.SSSxxx"),
                    },
                  },
                },
              },
              top_exceptions: {
                terms: {
                  field: 'error.message.keyword',
                  size: 5,
                },
              },
            },
          },
        },
      },
    };

    try {
      const response = await client.search(searchParams);
      const aggs = response.aggregations as any;

      const trends: ServiceExceptionTrend[] = [];
      if (aggs.services?.buckets) {
        for (const bucket of aggs.services.buckets) {
          const firstHalfCount = bucket.first_half.doc_count;
          const secondHalfCount = bucket.second_half.doc_count;

          const percentageChange =
            firstHalfCount > 0 ? ((secondHalfCount - firstHalfCount) / firstHalfCount) * 100 : 0;

          let trend = 'stable';
          if (percentageChange > 10) trend = 'increasing';
          else if (percentageChange < -10) trend = 'decreasing';

          trends.push({
            service: bucket.key,
            exceptionCount: bucket.total_exceptions.value,
            trend,
            percentageChange: Math.round(percentageChange),
            topExceptions: bucket.top_exceptions.buckets.map((exBucket: any) => ({
              message: exBucket.key,
              count: exBucket.doc_count,
            })),
          });
        }
      }

      return trends;
    } catch (error) {
      logger.error(`Error getting service exception trends for team ${teamId}:`, error);
      throw new Error(
        `Failed to get service exception trends: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private determineTrend(timeDistribution: any[]): string {
    if (timeDistribution.length < 2) return 'stable';

    const firstHalf = timeDistribution.slice(0, Math.floor(timeDistribution.length / 2));
    const secondHalf = timeDistribution.slice(Math.floor(timeDistribution.length / 2));

    const firstHalfAvg =
      firstHalf.reduce((sum, bucket) => sum + bucket.doc_count, 0) / firstHalf.length;
    const secondHalfAvg =
      secondHalf.reduce((sum, bucket) => sum + bucket.doc_count, 0) / secondHalf.length;

    const change = ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100;

    if (change > 10) return 'increasing';
    if (change < -10) return 'decreasing';
    return 'stable';
  }

  private generatePossibleCauses(exceptionMessage: string): string[] {
    const causes: string[] = [];

    if (exceptionMessage.toLowerCase().includes('null')) {
      causes.push('Null pointer or undefined variable access');
      causes.push('Missing null checks in code');
    }

    if (
      exceptionMessage.toLowerCase().includes('connection') ||
      exceptionMessage.toLowerCase().includes('network')
    ) {
      causes.push('Network connectivity issues');
      causes.push('Database or external service unavailable');
      causes.push('Timeout configuration too strict');
    }

    if (
      exceptionMessage.toLowerCase().includes('memory') ||
      exceptionMessage.toLowerCase().includes('heap')
    ) {
      causes.push('Memory leak or insufficient heap size');
      causes.push('Large data processing without proper cleanup');
    }

    if (
      exceptionMessage.toLowerCase().includes('permission') ||
      exceptionMessage.toLowerCase().includes('access')
    ) {
      causes.push('Insufficient permissions or access rights');
      causes.push('Authentication or authorization failure');
    }

    if (causes.length === 0) {
      causes.push('Code logic error or unexpected input');
      causes.push('External dependency failure');
      causes.push('Configuration mismatch');
    }

    return causes;
  }

  private generateSuggestedSolutions(exceptionMessage: string): string[] {
    const solutions: string[] = [];

    if (exceptionMessage.toLowerCase().includes('null')) {
      solutions.push('Add null checks before accessing variables or objects');
      solutions.push('Use optional chaining or safe navigation operators');
      solutions.push('Initialize variables with default values');
    }

    if (
      exceptionMessage.toLowerCase().includes('connection') ||
      exceptionMessage.toLowerCase().includes('network')
    ) {
      solutions.push('Implement retry mechanisms with exponential backoff');
      solutions.push('Add circuit breaker pattern for external services');
      solutions.push('Increase timeout configurations if appropriate');
      solutions.push('Add proper error handling for network failures');
    }

    if (
      exceptionMessage.toLowerCase().includes('memory') ||
      exceptionMessage.toLowerCase().includes('heap')
    ) {
      solutions.push('Increase JVM heap size or application memory limits');
      solutions.push('Implement proper resource cleanup (close streams, connections)');
      solutions.push('Optimize data processing to handle smaller chunks');
      solutions.push('Profile application for memory leaks');
    }

    if (
      exceptionMessage.toLowerCase().includes('permission') ||
      exceptionMessage.toLowerCase().includes('access')
    ) {
      solutions.push('Check and update file or resource permissions');
      solutions.push('Verify authentication credentials and tokens');
      solutions.push('Review authorization rules and policies');
    }

    if (solutions.length === 0) {
      solutions.push('Add comprehensive logging around the error location');
      solutions.push('Implement proper input validation and sanitization');
      solutions.push('Add unit tests to cover edge cases');
      solutions.push('Review and update documentation');
    }

    return solutions;
  }

  public closeAllConnections(): void {
    for (const [key, client] of this.clients.entries()) {
      try {
        client.close();
        logger.info(`Closed Elasticsearch connection: ${key}`);
      } catch (error) {
        logger.error(`Error closing connection ${key}:`, error);
      }
    }
    this.clients.clear();
  }
}
