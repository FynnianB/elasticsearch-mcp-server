import express, { type Response, type Request } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ElasticsearchMcpServer } from './elasticsearch-mcp-server.js';
import logger from './logger.js';
import { httpServerConfig } from './config.js';

const sseTransportStore = new Map<string, SSEServerTransport>();
const sseServerStore = new Map<string, ElasticsearchMcpServer>();

export async function startHttpServer(): Promise<void> {
  logger.info('Starting HTTP server supporting MCP protocol...');
  const app = express();

  app.use(express.json());

  app.get(httpServerConfig.ssePath, async (req: Request, res: Response) => {
    logger.info(`Received GET request to ${httpServerConfig.ssePath} (HTTP+SSE transport)`);

    // Extract team from query parameter
    const teamId = req.query.TEAM as string;
    if (!teamId) {
      logger.warn('Missing TEAM query parameter in SSE request');
      res.status(400).json({
        error: 'Missing TEAM query parameter. Please add ?TEAM=<team-id> to the URL.',
      });
      return;
    }

    // Validate team exists
    try {
      const { ConfigManager } = await import('./config/configManager.js');
      const configManager = new ConfigManager();
      configManager.getTeamConfig(teamId); // This will throw if team doesn't exist
    } catch (error) {
      logger.warn(
        `Invalid team ID '${teamId}' in SSE request: ${error instanceof Error ? error.message : String(error)}`
      );
      res.status(400).json({
        error: `Invalid team ID '${teamId}'. ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }

    try {
      const transport = new SSEServerTransport(httpServerConfig.messagesPath, res);
      const sessionId = transport.sessionId;

      logger.info(`Initializing new HTTP+SSE session with ID: ${sessionId} for team: ${teamId}`);
      sseTransportStore.set(sessionId, transport);

      const sessionMcpServer = new ElasticsearchMcpServer({
        name: `elasticsearch-mcp-sse-session-${sessionId}`,
        version: '1.0.0',
        teamId: teamId, // Pass the team ID to the MCP server
      });

      sseServerStore.set(sessionId, sessionMcpServer);

      // Keep the connection alive by sending a comment event every 2 minutes
      const keepAlive = setInterval(() => {
        res.write(':\n\n');
      }, 120000);

      res.on('close', () => {
        logger.info(`SSE connection closed for session ${sessionId}. Cleaning up resources.`);
        sseServerStore.delete(sessionId);
        sseTransportStore.delete(sessionId);
        clearInterval(keepAlive);
      });

      await sessionMcpServer.connect(transport);
    } catch (error) {
      logger.error('Error handling /sse request:', error);
      if (!res.headersSent) {
        res.status(500).send('Internal server error handling /sse request');
      } else {
        logger.error('Could not send error response for /sse as headers were already sent.');
        res.end();
      }
    }
  });

  app.post(httpServerConfig.messagesPath, async (req: Request, res: Response) => {
    logger.debug(`[POST ${httpServerConfig.messagesPath}] Received message body:`, req.body);
    const sessionId = req.query.sessionId as string | undefined;
    if (!sessionId) {
      logger.warn(
        `Invalid POST ${httpServerConfig.messagesPath} request: Missing sessionId query parameter.`
      );
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: `Bad Request: Missing sessionId query parameter for ${httpServerConfig.messagesPath}`,
        },
        id: (req.body as any)?.id ?? null,
      });
      return;
    }

    const transport = sseTransportStore.get(sessionId);
    if (!transport) {
      const message = sseTransportStore.has(sessionId)
        ? `Bad Request: Session exists but uses a different transport protocol (expected HTTP+SSE)`
        : `Bad Request: No active HTTP+SSE transport found for session ID ${sessionId}`;
      logger.warn(`Invalid POST ${httpServerConfig.messagesPath} request: ${message}`);
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message },
        id: (req.body as any)?.id ?? null,
      });
      return;
    }

    try {
      await transport.handlePostMessage(req, res, req.body);
    } catch (error) {
      logger.error(
        `Error handling POST ${httpServerConfig.messagesPath} for session ${sessionId}:`,
        error
      );
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: `Internal server error handling ${httpServerConfig.messagesPath} request`,
          },
          id: (req.body as any)?.id ?? null,
        });
      }
    }
  });

  // Health check endpoint
  app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'elasticsearch-mcp' });
  });

  //=============================================================================
  // SERVER START AND SHUTDOWN
  //=============================================================================
  try {
    const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
    app.listen(port, () => {
      logger.info(`HTTP server listening on port ${port} (all interfaces)`);
      logger.info(
        `  - HTTP+SSE:      ${httpServerConfig.ssePath} (GET), ${httpServerConfig.messagesPath} (POST)`
      );
      logger.info(`  - Health check:  /health (GET)`);
    });
  } catch (error) {
    logger.error('Failed to start HTTP listener:', error);
    throw error;
  }
}

export async function shutdownHttpServer(): Promise<void> {
  logger.info('Shutting down HTTP server transports and session servers...');
  const sseSessions = Array.from(sseTransportStore.keys());
  logger.info(`Closing ${sseSessions.length} HTTP+SSE transport(s)/server(s)...`);

  for (const sessionId of sseSessions) {
    sseTransportStore.delete(sessionId);
    sseServerStore.delete(sessionId);
  }

  if (sseTransportStore.size > 0 || sseServerStore.size > 0) {
    logger.warn(
      `Stores were not empty after shutdown loop: sse(${sseTransportStore.size}), sseServers(${sseServerStore.size}). Clearing remaining entries.`
    );
    sseTransportStore.clear();
    sseServerStore.clear();
  }

  logger.info('HTTP transports and session servers shutdown complete.');
}
