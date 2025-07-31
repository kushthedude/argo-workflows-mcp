import * as fs from 'fs/promises';
import * as path from 'path';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createLogger } from '../utils/logger.js';
import { SchemaParseError } from '../utils/errors.js';

const logger = createLogger('SchemaParser');

// OpenAPI schema types
interface OpenAPIParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie' | 'body' | 'formData'; // body and formData for Swagger 2.0
  required?: boolean;
  schema?: any;
  description?: string;
  
  // Swagger 2.0 parameter properties
  type?: string;
  format?: string;
  enum?: any[];
  items?: any;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
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

interface OpenAPIPath {
  [method: string]: OpenAPIOperation;
}

interface OpenAPISchema {
  // OpenAPI 3.x
  openapi?: string;
  servers?: Array<{
    url: string;
    description?: string;
  }>;
  components?: {
    schemas?: Record<string, any>;
    securitySchemes?: Record<string, any>;
  };
  
  // Swagger 2.0
  swagger?: string;
  host?: string;
  basePath?: string;
  schemes?: string[];
  consumes?: string[];
  produces?: string[];
  definitions?: Record<string, any>;
  securityDefinitions?: Record<string, any>;
  
  // Common to both
  info: {
    title: string;
    version: string;
    description?: string;
  };
  paths: Record<string, OpenAPIPath>;
}

export class OpenAPISchemaParser {
  private schema: OpenAPISchema | null = null;
  private readonly schemaPath: string;
  private tools: Tool[] = [];

  constructor(schemaPath: string) {
    this.schemaPath = path.resolve(schemaPath);
  }

  async initialize(): Promise<void> {
    try {
      logger.info('Loading OpenAPI schema', { path: this.schemaPath });
      
      const schemaContent = await fs.readFile(this.schemaPath, 'utf-8');
      this.schema = JSON.parse(schemaContent) as OpenAPISchema;
      
      this.validateSchema();
      
      const formatType = this.isSwagger2() ? 'Swagger 2.0' : 'OpenAPI 3.x';
      logger.info('API schema loaded successfully', {
        format: formatType,
        title: this.schema.info.title,
        version: this.schema.info.version,
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

  private validateSchema(): void {
    if (!this.schema) {
      throw new SchemaParseError('Schema not loaded', this.schemaPath);
    }

    const isOpenAPI3 = this.schema.openapi?.startsWith('3.');
    const isSwagger2 = this.schema.swagger === '2.0';
    
    if (!isOpenAPI3 && !isSwagger2) {
      const version = this.schema.openapi || this.schema.swagger || 'unknown';
      throw new SchemaParseError(
        `Unsupported API spec version: ${version}. Only OpenAPI 3.x and Swagger 2.0 are supported`,
        this.schemaPath
      );
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

        // Skip if no operationId or already processed
        if (!operation.operationId || processedOperations.has(operation.operationId)) {
          continue;
        }

        const tool = this.operationToTool(pathTemplate, method, operation);
        if (tool) {
          tools.push(tool);
          processedOperations.add(operation.operationId);
        }
      }
    }

    logger.info('Generated tools from OpenAPI schema', { count: tools.length });
    return tools;
  }

  private operationToTool(
    pathTemplate: string,
    method: string,
    operation: OpenAPIOperation
  ): Tool | null {
    try {
      const inputSchema = this.buildInputSchema(operation, pathTemplate, method);
      
      return {
        name: operation.operationId,
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

  private buildInputSchema(operation: OpenAPIOperation, _pathTemplate: string, _method: string): any {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    // Process parameters
    if (operation.parameters) {
      for (const param of operation.parameters) {
        // Skip body parameters in Swagger 2.0 as they're handled separately
        if (this.isSwagger2() && param.in === 'body') {
          continue;
        }
        
        let schema: any;
        
        if (this.isSwagger2()) {
          // Swagger 2.0: parameters can have type directly or schema
          if (param.schema) {
            schema = this.resolveSchema(param.schema);
          } else {
            // Convert Swagger 2.0 parameter definition to schema format
            schema = {
              type: param.type || 'string',
              format: param.format,
              enum: param.enum,
              items: param.items,
              minimum: param.minimum,
              maximum: param.maximum,
              minLength: param.minLength,
              maxLength: param.maxLength,
              pattern: param.pattern,
            };
            // Remove undefined properties
            Object.keys(schema).forEach(key => {
              if (schema[key] === undefined) {
                delete schema[key];
              }
            });
          }
        } else {
          // OpenAPI 3.x: parameters always have schema
          schema = this.resolveSchema(param.schema || { type: 'string' });
        }
        
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
    if (this.isOpenAPI3() && operation.requestBody?.content?.['application/json']?.schema) {
      // OpenAPI 3.x request body
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
    } else if (this.isSwagger2() && operation.parameters) {
      // Swagger 2.0: look for body parameter
      const bodyParam = operation.parameters.find(p => p.in === 'body');
      if (bodyParam) {
        const bodySchema = this.resolveSchema(bodyParam.schema || { type: 'object' });
        
        properties.body = {
          ...bodySchema,
          description: bodyParam.description || 'Request body',
        };
        
        if (bodyParam.required) {
          required.push('body');
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

  private buildDescription(
    operation: OpenAPIOperation,
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

  private resolveSchema(schema: any, visited: Set<string> = new Set()): any {
    if (!schema) return { type: 'string' };

    // Handle $ref
    if (schema.$ref) {
      // Check for circular reference
      if (visited.has(schema.$ref)) {
        logger.warn('Circular reference detected, returning fallback', { ref: schema.$ref });
        return { type: 'object', description: `Circular reference to ${schema.$ref}` };
      }
      
      visited.add(schema.$ref);
      const resolved = this.resolveRef(schema.$ref);
      const result = this.resolveSchema(resolved, visited);
      visited.delete(schema.$ref);
      return result;
    }

    // Handle allOf, oneOf, anyOf
    if (schema.allOf) {
      return this.mergeSchemas(schema.allOf.map((s: any) => this.resolveSchema(s, visited)));
    }

    if (schema.oneOf || schema.anyOf) {
      // Simplify to the first option for MCP tools
      const schemas = schema.oneOf || schema.anyOf;
      return this.resolveSchema(schemas[0], visited);
    }

    // Recursively resolve nested schemas
    const resolved = { ...schema };
    
    if (resolved.properties) {
      resolved.properties = Object.fromEntries(
        Object.entries(resolved.properties).map(([key, value]) => [
          key,
          this.resolveSchema(value, visited),
        ])
      );
    }

    if (resolved.items) {
      resolved.items = this.resolveSchema(resolved.items, visited);
    }

    return resolved;
  }

  private resolveRef(ref: string): any {
    if (!this.schema) {
      throw new SchemaParseError('Cannot resolve $ref: schema not loaded', this.schemaPath);
    }

    const parts = ref.split('/').slice(1); // Remove leading #
    let current: any = this.schema;

    for (const part of parts) {
      current = current[part];
      if (!current) {
        logger.warn('Failed to resolve reference', { ref, part });
        return { type: 'object' }; // Fallback instead of throwing
      }
    }

    return current;
  }

  private isSwagger2(): boolean {
    return this.schema?.swagger === '2.0';
  }

  private isOpenAPI3(): boolean {
    return Boolean(this.schema?.openapi?.startsWith('3.'));
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

  private isOperation(obj: any): obj is OpenAPIOperation {
    return obj && typeof obj === 'object' && 'operationId' in obj;
  }

  getOperationInfo(operationId: string): {
    method: string;
    path: string;
    operation: OpenAPIOperation;
  } | undefined {
    if (!this.schema) return undefined;

    for (const [pathTemplate, pathItem] of Object.entries(this.schema.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (this.isOperation(operation) && operation.operationId === operationId) {
          return { method, path: pathTemplate, operation };
        }
      }
    }

    return undefined;
  }
}