import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { Config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { ArgoClient } from '../client/argo-client.js';
import { OpenAPISchemaParser } from '../schema/parser.js';
import { ArgoWorkflowService } from './services/workflow-service.js';
import { handleError } from '../utils/errors.js';

const logger = createLogger('MCPServer');

export class ArgoMCPServer {
  private server: Server;
  private argoClient: ArgoClient;
  private schemaParser: OpenAPISchemaParser;
  private workflowService: ArgoWorkflowService;
  private tools: Tool[] = [];

  constructor(private readonly config: Config) {
    this.server = new Server(
      {
        name: 'argo-workflows-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.argoClient = new ArgoClient({ config: this.config });
    this.schemaParser = new OpenAPISchemaParser(this.config.SCHEMA_PATH);
    this.workflowService = new ArgoWorkflowService(this.argoClient, this.config);
    
    this.setupHandlers();
  }

  async initialize(): Promise<void> {
    try {
      // Load OpenAPI schema
      await this.schemaParser.initialize();
      
      // Get generated tools
      const schemaTools = this.schemaParser.getTools();
      
      // Add custom high-level tools
      const customTools = this.getCustomTools();
      
      // Combine all tools
      this.tools = [...schemaTools, ...customTools];
      
      logger.info('Server initialized', {
        schemaTools: schemaTools.length,
        customTools: customTools.length,
        totalTools: this.tools.length,
      });

      // Perform initial health check
      const health = await this.argoClient.healthCheck();
      logger.info('Initial health check', health);
    } catch (error) {
      logger.error('Failed to initialize server', { error });
      throw error;
    }
  }

  private setupHandlers(): void {
    // Handle tool listing
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.tools,
    }));

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      try {
        logger.info('Executing tool', { name, args });
        
        // Check if it's a custom tool
        const customHandler = this.getCustomToolHandler(name);
        if (customHandler) {
          const result = await customHandler(args);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        // Otherwise, it's an OpenAPI-generated tool
        const result = await this.handleOpenAPITool(name, args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const errorObj = handleError(error);
        logger.error('Tool execution failed', {
          tool: name,
          error: errorObj.toJSON(),
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: errorObj.message,
                details: errorObj.context,
              }, null, 2),
            },
          ],
          isError: true,
        };
      }
    });
  }

  private getCustomTools(): Tool[] {
    return [
      {
        name: 'health_check',
        description: 'Check the health and connectivity of the Argo server',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'list_workflows',
        description: 'List workflows with advanced filtering, pagination, and sorting options',
        inputSchema: {
          type: 'object',
          properties: {
            namespace: {
              type: 'string',
              description: 'Namespace to list workflows from',
            },
            labelSelector: {
              type: 'string',
              description: 'Label selector to filter workflows (e.g., "app=myapp,version=v1")',
            },
            fieldSelector: {
              type: 'string',
              description: 'Field selector to filter workflows',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of workflows to return (max: 1000)',
              default: 100,
              minimum: 1,
              maximum: 1000,
            },
            offset: {
              type: 'number',
              description: 'Number of workflows to skip for pagination',
              minimum: 0,
            },
            continue: {
              type: 'string',
              description: 'Continue token for pagination',
            },
            phase: {
              oneOf: [
                { type: 'string' },
                { type: 'array', items: { type: 'string' } }
              ],
              description: 'Filter by workflow phase(s): Pending, Running, Succeeded, Failed, Error',
            },
            name: {
              type: 'string',
              description: 'Filter by exact workflow name',
            },
            namePrefix: {
              type: 'string',
              description: 'Filter by workflow name prefix',
            },
            status: {
              type: 'string',
              description: 'Filter by workflow status',
            },
            createdAfter: {
              type: 'string',
              description: 'Filter workflows created after this date (ISO 8601)',
              format: 'date-time',
            },
            createdBefore: {
              type: 'string',
              description: 'Filter workflows created before this date (ISO 8601)',
              format: 'date-time',
            },
            startedAfter: {
              type: 'string',
              description: 'Filter workflows started after this date (ISO 8601)',
              format: 'date-time',
            },
            startedBefore: {
              type: 'string',
              description: 'Filter workflows started before this date (ISO 8601)',
              format: 'date-time',
            },
            finishedAfter: {
              type: 'string',
              description: 'Filter workflows finished after this date (ISO 8601)',
              format: 'date-time',
            },
            finishedBefore: {
              type: 'string',
              description: 'Filter workflows finished before this date (ISO 8601)',
              format: 'date-time',
            },
            sortBy: {
              type: 'string',
              enum: ['name', 'creationTimestamp', 'startedAt', 'finishedAt', 'phase'],
              description: 'Field to sort by',
              default: 'creationTimestamp',
            },
            sortOrder: {
              type: 'string',
              enum: ['asc', 'desc'],
              description: 'Sort order',
              default: 'desc',
            },
            includeCompleted: {
              type: 'boolean',
              description: 'Include completed workflows',
              default: true,
            },
            resourceVersion: {
              type: 'string',
              description: 'Resource version for watch operations',
            },
          },
        },
      },
      {
        name: 'get_workflow',
        description: 'Get detailed information about a specific workflow',
        inputSchema: {
          type: 'object',
          properties: {
            namespace: {
              type: 'string',
              description: 'Namespace of the workflow',
            },
            name: {
              type: 'string',
              description: 'Name of the workflow',
            },
          },
          required: ['namespace', 'name'],
        },
      },
      {
        name: 'workflow_logs',
        description: 'Get logs from a workflow',
        inputSchema: {
          type: 'object',
          properties: {
            namespace: {
              type: 'string',
              description: 'Namespace of the workflow',
            },
            name: {
              type: 'string',
              description: 'Name of the workflow',
            },
            podName: {
              type: 'string',
              description: 'Specific pod name (optional)',
            },
            container: {
              type: 'string',
              description: 'Container name',
              default: 'main',
            },
            follow: {
              type: 'boolean',
              description: 'Follow log stream',
              default: false,
            },
          },
          required: ['namespace', 'name'],
        },
      },
      {
        name: 'submit_workflow',
        description: 'Submit a new workflow from a template',
        inputSchema: {
          type: 'object',
          properties: {
            namespace: {
              type: 'string',
              description: 'Namespace to submit workflow to',
            },
            template: {
              type: 'string',
              description: 'Workflow template name',
            },
            parameters: {
              type: 'object',
              description: 'Parameters to pass to the workflow',
              additionalProperties: true,
            },
            labels: {
              type: 'object',
              description: 'Labels to add to the workflow',
              additionalProperties: { type: 'string' },
            },
          },
          required: ['namespace', 'template'],
        },
      },
      {
        name: 'retry_workflow',
        description: 'Retry a failed workflow',
        inputSchema: {
          type: 'object',
          properties: {
            namespace: {
              type: 'string',
              description: 'Namespace of the workflow',
            },
            name: {
              type: 'string',
              description: 'Name of the workflow to retry',
            },
          },
          required: ['namespace', 'name'],
        },
      },
      {
        name: 'terminate_workflow',
        description: 'Terminate a running workflow',
        inputSchema: {
          type: 'object',
          properties: {
            namespace: {
              type: 'string',
              description: 'Namespace of the workflow',
            },
            name: {
              type: 'string',
              description: 'Name of the workflow to terminate',
            },
            reason: {
              type: 'string',
              description: 'Reason for termination',
            },
          },
          required: ['namespace', 'name'],
        },
      },
      {
        name: 'get_recent_workflows',
        description: 'Get the most recently created workflows',
        inputSchema: {
          type: 'object',
          properties: {
            namespace: {
              type: 'string',
              description: 'Namespace to query',
            },
            limit: {
              type: 'number',
              description: 'Number of workflows to return',
              default: 10,
              minimum: 1,
              maximum: 100,
            },
          },
        },
      },
      {
        name: 'get_failed_workflows',
        description: 'Get workflows that have failed',
        inputSchema: {
          type: 'object',
          properties: {
            namespace: {
              type: 'string',
              description: 'Namespace to query',
            },
            since: {
              type: 'string',
              description: 'Get failures since this date (ISO 8601)',
              format: 'date-time',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of workflows to return',
              default: 100,
            },
          },
        },
      },
      {
        name: 'get_running_workflows',
        description: 'Get currently running workflows',
        inputSchema: {
          type: 'object',
          properties: {
            namespace: {
              type: 'string',
              description: 'Namespace to query',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of workflows to return',
              default: 100,
            },
          },
        },
      },
      {
        name: 'search_workflows_by_name',
        description: 'Search workflows by name prefix',
        inputSchema: {
          type: 'object',
          properties: {
            namePattern: {
              type: 'string',
              description: 'Name prefix to search for',
            },
            namespace: {
              type: 'string',
              description: 'Namespace to search in',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results',
              default: 100,
            },
          },
          required: ['namePattern'],
        },
      },
      {
        name: 'get_workflows_by_label',
        description: 'Get workflows matching specific labels',
        inputSchema: {
          type: 'object',
          properties: {
            labels: {
              type: 'object',
              description: 'Label key-value pairs to match',
              additionalProperties: { type: 'string' },
            },
            namespace: {
              type: 'string',
              description: 'Namespace to query',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results',
              default: 100,
            },
          },
          required: ['labels'],
        },
      },
    ];
  }

  private getCustomToolHandler(name: string): ((args: any) => Promise<any>) | undefined {
    const handlers: Record<string, (args: any) => Promise<any>> = {
      health_check: async () => this.argoClient.healthCheck(),
      
      list_workflows: async (args) => this.workflowService.listWorkflows(args),
      
      get_workflow: async (args) => this.workflowService.getWorkflow(args.namespace, args.name),
      
      workflow_logs: async (args) => this.workflowService.getWorkflowLogs(
        args.namespace,
        args.name,
        args.podName,
        args.container || 'main',
        args.follow || false
      ),
      
      submit_workflow: async (args) => this.workflowService.submitWorkflow(
        args.namespace,
        args.template,
        args.parameters,
        args.labels
      ),
      
      retry_workflow: async (args) => this.workflowService.retryWorkflow(
        args.namespace,
        args.name
      ),
      
      terminate_workflow: async (args) => this.workflowService.terminateWorkflow(
        args.namespace,
        args.name,
        args.reason
      ),
      
      get_recent_workflows: async (args) => this.workflowService.getRecentWorkflows(
        args.namespace,
        args.limit || 10
      ),
      
      get_failed_workflows: async (args) => this.workflowService.getFailedWorkflows(
        args.namespace,
        args.since,
        args.limit || 100
      ),
      
      get_running_workflows: async (args) => this.workflowService.getRunningWorkflows(
        args.namespace,
        args.limit || 100
      ),
      
      search_workflows_by_name: async (args) => this.workflowService.searchWorkflowsByName(
        args.namePattern,
        args.namespace,
        args.limit || 100
      ),
      
      get_workflows_by_label: async (args) => this.workflowService.getWorkflowsByLabel(
        args.labels,
        args.namespace,
        args.limit || 100
      ),
    };

    return handlers[name];
  }

  private async handleOpenAPITool(operationId: string, args: any): Promise<any> {
    const operationInfo = this.schemaParser.getOperationInfo(operationId);
    
    if (!operationInfo) {
      throw new Error(`Unknown operation: ${operationId}`);
    }

    const { method, path } = operationInfo;
    
    // Build the URL by replacing path parameters
    let url = path;
    const pathParams: string[] = [];
    const queryParams: Record<string, any> = {};
    const bodyData: any = args.body;

    // Extract path parameters
    const pathParamMatches = path.match(/{([^}]+)}/g);
    if (pathParamMatches) {
      for (const match of pathParamMatches) {
        const paramName = match.slice(1, -1);
        if (args[paramName] !== undefined) {
          url = url.replace(match, args[paramName]);
          pathParams.push(paramName);
        }
      }
    }

    // Separate query parameters from path parameters
    for (const [key, value] of Object.entries(args)) {
      if (key !== 'body' && !pathParams.includes(key) && !key.startsWith('_')) {
        queryParams[key] = value;
      }
    }

    // Make the request
    const config = {
      params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
    };

    switch (method.toLowerCase()) {
      case 'get':
        return this.argoClient.get(url, config);
      case 'post':
        return this.argoClient.post(url, bodyData, config);
      case 'put':
        return this.argoClient.put(url, bodyData, config);
      case 'patch':
        return this.argoClient.patch(url, bodyData, config);
      case 'delete':
        return this.argoClient.delete(url, config);
      default:
        throw new Error(`Unsupported HTTP method: ${method}`);
    }
  }

  async start(transport: StdioServerTransport): Promise<void> {
    await this.server.connect(transport);
    logger.info('MCP server connected to transport');
  }
}