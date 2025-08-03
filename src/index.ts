import express, { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { ArgoMCPServer } from './server/index.js';
import { gracefulShutdown, registerShutdownHandler } from './utils/shutdown.js';

// Map to store transports and servers by session ID
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};
const servers: { [sessionId: string]: ArgoMCPServer } = {};

async function main(): Promise<void> {
  try {
    logger.info('Starting Argo MCP Server', {
      version: process.env.npm_package_version || '1.0.0',
      node: process.version,
      env: config.NODE_ENV,
      transport: 'streamable-http',
    });

    const app = express();
    app.use(express.json());

    // Middleware for authentication
    const authenticate = (req: Request, res: Response, next: NextFunction) => {
      if (config.HTTP_AUTH_TOKEN) {
        const authHeader = req.headers.authorization;
        if (!authHeader || authHeader !== `Bearer ${config.HTTP_AUTH_TOKEN}`) {
          res.status(401).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Unauthorized',
            },
            id: null,
          });
          return;
        }
      }
      next();
    };

    // Apply authentication to all routes
    app.use(config.HTTP_PATH, authenticate);

    // Handle POST requests for client-to-server communication
    app.post(config.HTTP_PATH, async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport;
      let server: ArgoMCPServer;

      if (sessionId && transports[sessionId]) {
        // Reuse existing transport and server
        transport = transports[sessionId];
        server = servers[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // New initialization request
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            // Store the transport and server by session ID
            transports[newSessionId] = transport;
            servers[newSessionId] = server;
            logger.info('New session initialized', { sessionId: newSessionId });
          },
          // Enable DNS rebinding protection for security
          enableDnsRebindingProtection: config.HTTP_VALIDATE_ORIGIN,
          allowedHosts: config.HTTP_ALLOWED_ORIGINS,
        });

        // Clean up transport when closed
        transport.onclose = () => {
          if (transport.sessionId) {
            delete transports[transport.sessionId];
            delete servers[transport.sessionId];
            logger.info('Session closed', { sessionId: transport.sessionId });
          }
        };

        // Create new MCP server instance for this session
        server = new ArgoMCPServer(config);
        
        try {
          // Initialize the server (load OpenAPI schema, etc.)
          await server.initialize();
          
          // Get the underlying MCP server
          const mcpServer = server.getMcpServer();
          
          // Connect to the transport
          await mcpServer.connect(transport);
        } catch (error) {
          logger.error('Failed to initialize server for session', { error });
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal error: Failed to initialize server',
            },
            id: null,
          });
          return;
        }
      } else {
        // Invalid request
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: No valid session ID provided',
          },
          id: null,
        });
        return;
      }

      // Handle the request
      await transport.handleRequest(req, res, req.body);
    });

    // Reusable handler for GET and DELETE requests
    const handleSessionRequest = async (req: Request, res: Response) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !transports[sessionId]) {
        res.status(400).send('Invalid or missing session ID');
        return;
      }
      
      const transport = transports[sessionId];
      await transport.handleRequest(req, res);
    };

    // Handle GET requests for server-to-client notifications via SSE
    app.get(config.HTTP_PATH, handleSessionRequest);

    // Handle DELETE requests for session termination
    app.delete(config.HTTP_PATH, handleSessionRequest);

    // Session cleanup interval
    setInterval(() => {
      // This is a simplified cleanup
      // In production, you might track last activity time per session
      for (const [sessionId, transport] of Object.entries(transports)) {
        // Check if transport is still active
        if (!transport.sessionId) {
          delete transports[sessionId];
          delete servers[sessionId];
        }
      }
    }, 60000); // Every minute

    // Register shutdown handler
    registerShutdownHandler(async () => {
      logger.info('Shutting down HTTP server');
      
      // Close all transports
      for (const transport of Object.values(transports)) {
        transport.close();
      }
      
      // Clear maps
      Object.keys(transports).forEach(key => delete transports[key]);
      Object.keys(servers).forEach(key => delete servers[key]);
    });

    // Start the Express server
    const server = app.listen(config.HTTP_PORT, config.HTTP_HOST, () => {
      logger.info('Streamable HTTP MCP Server started', {
        url: `http://${config.HTTP_HOST}:${config.HTTP_PORT}${config.HTTP_PATH}`,
        security: {
          authRequired: !!config.HTTP_AUTH_TOKEN,
          dnsRebindingProtection: config.HTTP_VALIDATE_ORIGIN,
        },
      });
    });

    // Handle server errors
    server.on('error', (error) => {
      logger.error('HTTP server error', { error });
      process.exit(1);
    });

  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
gracefulShutdown();

// Start the server
main();