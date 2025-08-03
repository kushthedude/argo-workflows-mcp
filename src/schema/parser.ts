import * as fs from 'fs/promises';
import * as path from 'path';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createLogger } from '../utils/logger.js';
import { SchemaParseError } from '../utils/errors.js';

const logger = createLogger('SchemaParser');

// OpenAPI 2.x (Swagger) types
interface SwaggerParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'body' | 'formData';
  required?: boolean;
  type?: string;
  schema?: any;
  description?: string;
  items?: any;
}

interface SwaggerOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: SwaggerParameter[];
  responses?: Record<string, any>;
  security?: Array<Record<string, string[]>>;
  consumes?: string[];
  produces?: string[];
}

// OpenAPI 3.x types
interface OpenAPIParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  schema?: any;
  description?: string;
}

interface OpenAPIOperation {
  operationId: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenAPIParameter[];
  requestBody?: {
    required?: boolean;
    content?: {
      'application/json'?: {
        schema?: any;
      };
    };
  };
  responses?: Record<string, any>;
  security?: Array<Record<string, string[]>>;
}

type Operation = OpenAPIOperation | SwaggerOperation;

// Base schema interface
interface BaseSchema {
  info: {
    title: string;
    version: string;
    description?: string;
  };
  paths: Record<string, Record<string, Operation>>;
}

// OpenAPI 3.x schema
interface OpenAPI3Schema extends BaseSchema {
  openapi: string;
  servers?: Array<{
    url: string;
    description?: string;
  }>;
  components?: {
    schemas?: Record<string, any>;
    securitySchemes?: Record<string, any>;
  };
}

// OpenAPI 2.x (Swagger) schema
interface OpenAPI2Schema extends BaseSchema {
  swagger: string;
  host?: string;
  basePath?: string;
  schemes?: string[];
  definitions?: Record<string, any>;
  securityDefinitions?: Record<string, any>;
}

type OpenAPISchema = OpenAPI3Schema | OpenAPI2Schema;

export class OpenAPISchemaParser {
  private schema: OpenAPISchema | null = null;
  private readonly schemaPath: string;
  private tools: Tool[] = [];
  private isOpenAPI3: boolean = false;

  constructor(schemaPath: string) {
    this.schemaPath = path.resolve(schemaPath);
  }

  async initialize(): Promise<void> {
    try {
      logger.info('Loading OpenAPI schema', { path: this.schemaPath });
      
      const schemaContent = await fs.readFile(this.schemaPath, 'utf-8');
      this.schema = JSON.parse(schemaContent) as OpenAPISchema;
      
      this.detectVersion();
      this.validateSchema();
      
      logger.info('OpenAPI schema loaded successfully', {
        title: this.schema.info.title,
        version: this.schema.info.version,
        apiVersion: this.isOpenAPI3 ? '3.x' : '2.x',
        pathCount: Object.keys(this.schema.paths).length,
      });

      // Generate tools after loading schema
      this.tools = this.generateTools();
    } catch (error) {
      if (error instanceof Error) {
        throw new SchemaParseError(error.message, this.schemaPath);
      }
      throw error;
    }
  }

  private detectVersion(): void {
    if (!this.schema) return;

    if ('openapi' in this.schema && this.schema.openapi.startsWith('3.')) {
      this.isOpenAPI3 = true;
    } else if ('swagger' in this.schema && this.schema.swagger === '2.0') {
      this.isOpenAPI3 = false;
    } else {
      throw new SchemaParseError(
        'Unsupported API specification version. Only OpenAPI 3.x and Swagger 2.0 are supported',
        this.schemaPath
      );
    }
  }

  private validateSchema(): void {
    if (!this.schema) {
      throw new SchemaParseError('Schema not loaded', this.schemaPath);
    }

    if (!this.schema.paths || Object.keys(this.schema.paths).length === 0) {
      throw new SchemaParseError('No paths found in schema', this.schemaPath);
    }
  }

  getTools(): Tool[] {
    return this.tools;
  }

  private generateTools(): Tool[] {
    if (!this.schema) {
      throw new SchemaParseError('Schema not initialized', this.schemaPath);
    }

    const tools: Tool[] = [];
    const processedOperations = new Set<string>();

    for (const [pathTemplate, pathItem] of Object.entries(this.schema.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!this.isHttpMethod(method)) continue;
        if (!this.isOperation(operation)) continue;

        // Generate operationId if missing (common in Swagger 2.0)
        const operationId = operation.operationId || this.generateOperationId(method, pathTemplate);
        
        if (processedOperations.has(operationId)) {
          continue;
        }

        const tool = this.operationToTool(pathTemplate, method, { ...operation, operationId });
        if (tool) {
          tools.push(tool);
          processedOperations.add(operationId);
        }
      }
    }

    logger.info('Generated tools from OpenAPI schema', { count: tools.length });
    return tools;
  }

  private generateOperationId(method: string, path: string): string {
    // Generate a readable operationId from method and path
    const pathParts = path.split('/').filter(p => p && !p.startsWith('{'));
    const camelCasePath = pathParts
      .map((part, index) => {
        if (index === 0) return part;
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join('');
    
    return `${method.toLowerCase()}${camelCasePath.charAt(0).toUpperCase() + camelCasePath.slice(1)}`;
  }

  private operationToTool(
    pathTemplate: string,
    method: string,
    operation: Operation
  ): Tool | null {
    try {
      const inputSchema = this.isOpenAPI3
        ? this.buildInputSchemaV3(operation as OpenAPIOperation, pathTemplate, method)
        : this.buildInputSchemaV2(operation as SwaggerOperation, pathTemplate, method);
      
      return {
        name: operation.operationId!,
        description: this.buildDescription(operation, method, pathTemplate),
        inputSchema,
      };
    } catch (error) {
      logger.warn('Failed to generate tool for operation', {
        operationId: operation.operationId,
        error: error instanceof Error ? error.message : error,
      });
      return null;
    }
  }

  private buildInputSchemaV3(operation: OpenAPIOperation, _pathTemplate: string, _method: string): any {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    // Process parameters
    if (operation.parameters) {
      for (const param of operation.parameters) {
        const schema = this.resolveSchema(param.schema || { type: 'string' });
        
        properties[param.name] = {
          ...schema,
          description: param.description,
        };

        if (param.required) {
          required.push(param.name);
        }
      }
    }

    // Process request body
    if (operation.requestBody?.content?.['application/json']?.schema) {
      const bodySchema = this.resolveSchema(
        operation.requestBody.content['application/json'].schema
      );

      properties.body = {
        ...bodySchema,
        description: 'Request body',
      };
      
      if (operation.requestBody.required) {
        required.push('body');
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
      additionalProperties: false,
    };
  }

  private buildInputSchemaV2(operation: SwaggerOperation, _pathTemplate: string, _method: string): any {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    if (operation.parameters) {
      for (const param of operation.parameters) {
        if (param.in === 'body') {
          // Body parameter in Swagger 2.0
          const bodySchema = this.resolveSchema(param.schema || { type: 'object' });
          properties.body = {
            ...bodySchema,
            description: param.description || 'Request body',
          };
          
          if (param.required) {
            required.push('body');
          }
        } else {
          // Other parameters (path, query, header)
          const schema = this.convertSwaggerParamToSchema(param);
          
          properties[param.name] = {
            ...schema,
            description: param.description,
          };

          if (param.required) {
            required.push(param.name);
          }
        }
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
      additionalProperties: false,
    };
  }

  private convertSwaggerParamToSchema(param: SwaggerParameter): any {
    const schema: any = {};

    if (param.type) {
      schema.type = param.type;
    }

    if (param.items) {
      schema.items = param.items;
    }

    // Add more Swagger 2.0 specific conversions as needed
    if (param.type === 'integer') {
      schema.type = 'number';
    }

    return schema;
  }

  private buildDescription(
    operation: Operation,
    method: string,
    pathTemplate: string
  ): string {
    const parts: string[] = [];

    if (operation.summary) {
      parts.push(operation.summary);
    } else if (operation.description) {
      parts.push(operation.description.split('\n')[0]);
    } else {
      parts.push(`${method.toUpperCase()} ${pathTemplate}`);
    }

    if (operation.tags && operation.tags.length > 0) {
      parts.push(`[${operation.tags.join(', ')}]`);
    }

    if (operation.description && operation.summary && operation.description !== operation.summary) {
      parts.push('\n\n' + operation.description);
    }

    return parts.join(' ');
  }

  private resolveSchema(schema: any): any {
    if (!schema) return { type: 'string' };

    // Handle $ref
    if (schema.$ref) {
      const resolved = this.resolveRef(schema.$ref);
      return this.resolveSchema(resolved);
    }

    // Handle allOf, oneOf, anyOf
    if (schema.allOf) {
      return this.mergeSchemas(schema.allOf.map((s: any) => this.resolveSchema(s)));
    }

    if (schema.oneOf || schema.anyOf) {
      // Simplify to the first option for MCP tools
      const schemas = schema.oneOf || schema.anyOf;
      return this.resolveSchema(schemas[0]);
    }

    // Recursively resolve nested schemas
    const resolved = { ...schema };
    
    if (resolved.properties) {
      resolved.properties = Object.fromEntries(
        Object.entries(resolved.properties).map(([key, value]) => [
          key,
          this.resolveSchema(value),
        ])
      );
    }

    if (resolved.items) {
      resolved.items = this.resolveSchema(resolved.items);
    }

    return resolved;
  }

  private resolveRef(ref: string): any {
    if (!this.schema) {
      throw new SchemaParseError('Cannot resolve $ref: schema not loaded', this.schemaPath);
    }

    const parts = ref.split('/').slice(1); // Remove leading #
    let current: any = this.schema;

    // Handle different reference paths for v2 vs v3
    if (!this.isOpenAPI3 && parts[0] === 'definitions') {
      // Swagger 2.0 uses #/definitions/
      current = (this.schema as OpenAPI2Schema).definitions;
      parts.shift();
    } else if (this.isOpenAPI3 && parts[0] === 'components') {
      // OpenAPI 3.x uses #/components/schemas/
      current = (this.schema as OpenAPI3Schema).components;
      parts.shift();
    }

    for (const part of parts) {
      current = current?.[part];
      if (!current) {
        throw new SchemaParseError(`Cannot resolve $ref: ${ref}`, this.schemaPath);
      }
    }

    return current;
  }

  private mergeSchemas(schemas: any[]): any {
    // Simple merge for allOf
    const merged: any = { type: 'object', properties: {}, required: [] };

    for (const schema of schemas) {
      if (schema.properties) {
        Object.assign(merged.properties, schema.properties);
      }
      if (schema.required) {
        merged.required.push(...schema.required);
      }
    }

    merged.required = [...new Set(merged.required)];
    if (merged.required.length === 0) {
      delete merged.required;
    }

    return merged;
  }

  private isHttpMethod(method: string): boolean {
    return ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(
      method.toLowerCase()
    );
  }

  private isOperation(obj: any): obj is Operation {
    return obj && typeof obj === 'object' && (
      'operationId' in obj ||
      'summary' in obj ||
      'description' in obj ||
      'parameters' in obj ||
      'responses' in obj
    );
  }

  getOperationInfo(operationId: string): {
    method: string;
    path: string;
    operation: Operation;
  } | undefined {
    if (!this.schema) return undefined;

    for (const [pathTemplate, pathItem] of Object.entries(this.schema.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (this.isOperation(operation)) {
          const opId = operation.operationId || this.generateOperationId(method, pathTemplate);
          if (opId === operationId) {
            return { 
              method, 
              path: pathTemplate, 
              operation: { ...operation, operationId: opId }
            };
          }
        }
      }
    }

    return undefined;
  }

  getSchemaVersion(): string {
    if (!this.schema) return 'unknown';
    
    if ('openapi' in this.schema) {
      return `OpenAPI ${this.schema.openapi}`;
    } else if ('swagger' in this.schema) {
      return `Swagger ${this.schema.swagger}`;
    }
    
    return 'unknown';
  }
}