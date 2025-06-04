import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTool as registerSearchExceptionsTool } from './elasticsearch-mcp-tools/search-exceptions-tool.js';
import { registerTool as registerAnalyzeExceptionTool } from './elasticsearch-mcp-tools/analyze-specific-exception-tool.js';
import { registerTool as registerAnalyzeTrendsTool } from './elasticsearch-mcp-tools/analyze-trends-tool.js';
import { registerTool as registerSearchLogsTool } from './elasticsearch-mcp-tools/search-logs-tool.js';
import { registerTool as registerTestConnectionTool } from './elasticsearch-mcp-tools/test-connection-tool.js';

export interface ElasticsearchMcpServerOptions {
  name: string;
  version: string;
  teamId?: string;
  [key: string]: unknown;
}

function registerElasticsearchTools(mcpServer: McpServer, teamId?: string): void {
  registerSearchExceptionsTool(mcpServer, teamId);
  registerAnalyzeExceptionTool(mcpServer, teamId);
  registerAnalyzeTrendsTool(mcpServer, teamId);
  registerSearchLogsTool(mcpServer, teamId);
  registerTestConnectionTool(mcpServer, teamId);
}

export class ElasticsearchMcpServer extends McpServer {
  private teamId?: string;

  constructor(options: ElasticsearchMcpServerOptions) {
    super(options);
    this.teamId = options.teamId;
    registerElasticsearchTools(this, this.teamId);
  }

  getTeamId(): string | undefined {
    return this.teamId;
  }
}
