export interface ElasticsearchEnvironmentConfig {
  node: string;
  apiKey?: string;
  username?: string;
  password?: string;
  maxRetries?: number;
  requestTimeout?: number;
}

export interface TeamConfig {
  teamId: string;
  teamName: string;
  defaultEnvironment?: string;
  environments: Record<string, ElasticsearchEnvironmentConfig>;
  indexPatterns: {
    exceptions: string[];
    applications: string[];
    logs?: string[];
  };
  maxSearchResults?: number;
  allowedOperations?: string[];
}

export interface MultiTeamConfig {
  server: {
    name: string;
    version: string;
  };
  teams: Record<string, TeamConfig>;
}

export interface SearchFilters {
  teamId?: string;
  environment?: string;
  timeRange?: {
    start: string;
    end: string;
  };
  timeframe?: string;
  severity?: string;
  service?: string;
  message?: string;
  limit?: number;
  sortByFrequency?: boolean;
}

export interface ElasticsearchSearchResult {
  id: string;
  index: string;
  timestamp: string;
  message: string;
  level?: string;
  service?: string;
  environment?: string;
  stack_trace?: string;
  tags?: string[];
  fields?: Record<string, unknown>;
  count?: number;
}

export interface ExceptionAnalysis {
  totalCount: number;
  uniqueExceptions: number;
  topExceptions: Array<{
    message: string;
    count: number;
    firstSeen: string;
    lastSeen: string;
    affectedServices: string[];
  }>;
  timeDistribution: Array<{
    timestamp: string;
    count: number;
  }>;
}

export interface FrequentException {
  message: string;
  count: number;
  service: string;
  timestamp: string;
  stackTrace?: string;
}

export interface ExceptionByContext {
  message: string;
  service: string;
  timestamp: string;
  stackTrace?: string;
}

export interface SpecificExceptionAnalysis {
  exception: {
    message: string;
    service: string;
    stackTrace?: string;
  };
  frequency: {
    total: number;
    trend: string;
  };
  affectedServices: string[];
  possibleCauses: string[];
  suggestedSolutions: string[];
}

export interface ServiceExceptionTrend {
  service: string;
  exceptionCount: number;
  trend: string;
  percentageChange: number;
  topExceptions: Array<{
    message: string;
    count: number;
  }>;
}
