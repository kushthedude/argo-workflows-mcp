
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { ArgoMCPServer } from './server/index.js';
import { gracefulShutdown } from './utils/shutdown.js';

async function main(): Promise<void> {
  try {
    logger.info('Starting Argo MCP Server', {
      version: process.env.npm_package_version || '1.0.0',
      node: process.version,
      env: config.NODE_ENV,
    });

    // Create and initialize server
    const server = new ArgoMCPServer(config);
    
    // Load OpenAPI schema
    await server.initialize();

    // Setup transport
    const transport = new StdioServerTransport();
    
    // Start server
    await server.start(transport);
    
    logger.info('Argo MCP Server started successfully');
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
gracefulShutdown();

// Start the server
main();