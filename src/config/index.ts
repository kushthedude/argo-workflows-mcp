import { z } from 'zod';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const ConfigSchema = z.object({
  // Server Configuration
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),
  
  // Transport Configuration
  TRANSPORT_TYPE: z.enum(['stdio', 'http']).default('http'),
  
  // HTTP Transport Configuration
  HTTP_PORT: z.number().int().positive().default(8080),
  HTTP_HOST: z.string().default('127.0.0.1'), // Bind to localhost by default for security
  HTTP_PATH: z.string().default('/mcp'),
  HTTP_SESSION_TTL: z.number().int().positive().default(3600000), // 1 hour
  HTTP_AUTH_TOKEN: z.string().optional(),
  HTTP_VALIDATE_ORIGIN: z
    .string()
    .transform(val => val === 'true')
    .default('true'),
  HTTP_ALLOWED_ORIGINS: z
    .string()
    .transform(val => val.split(',').map(s => s.trim()).filter(Boolean))
    .default('http://localhost,https://localhost,http://localhost:3000,https://localhost:3000,http://localhost:8080,https://localhost:8080,http://localhost:8083,https://localhost:8083'),
  
  // Argo Configuration
  ARGO_SERVER_URL: z.string().url(),
  ARGO_TOKEN: z.string().optional(),
  ARGO_NAMESPACE: z.string().default('default'),
  ARGO_INSECURE_SKIP_VERIFY: z
    .string()
    .transform(val => val === 'true')
    .default('false'),
  
  // API Configuration
  API_TIMEOUT_MS: z.number().int().positive().default(30000),
  API_RETRY_ATTEMPTS: z.number().int().min(0).max(10).default(3),
  API_RETRY_DELAY_MS: z.number().int().positive().default(1000),
  API_RETRY_MAX_DELAY_MS: z.number().int().positive().default(10000),
  
  // Schema Configuration
  SCHEMA_PATH: z.string().default('./schema/argo-openapi.json'),
});

export type Config = z.infer<typeof ConfigSchema>;

class ConfigManager {
  private static instance: ConfigManager;
  private configData: Config;

  private constructor() {
    this.configData = this.loadConfig();
  }

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  private loadConfig(): Config {
    try {
      const rawConfig = {
        NODE_ENV: process.env.NODE_ENV,
        LOG_LEVEL: process.env.LOG_LEVEL,
        LOG_FORMAT: process.env.LOG_FORMAT,
        
        HTTP_PORT: process.env.HTTP_PORT ? parseInt(process.env.HTTP_PORT) : undefined,
        HTTP_HOST: process.env.HTTP_HOST,
        HTTP_PATH: process.env.HTTP_PATH,
        HTTP_SESSION_TTL: process.env.HTTP_SESSION_TTL ? parseInt(process.env.HTTP_SESSION_TTL) : undefined,
        HTTP_AUTH_TOKEN: process.env.HTTP_AUTH_TOKEN,
        HTTP_VALIDATE_ORIGIN: process.env.HTTP_VALIDATE_ORIGIN,
        HTTP_ALLOWED_ORIGINS: process.env.HTTP_ALLOWED_ORIGINS,
        
        ARGO_SERVER_URL: process.env.ARGO_SERVER_URL,
        ARGO_TOKEN: process.env.ARGO_TOKEN,
        ARGO_NAMESPACE: process.env.ARGO_NAMESPACE,
        ARGO_INSECURE_SKIP_VERIFY: process.env.ARGO_INSECURE_SKIP_VERIFY,
        
        API_TIMEOUT_MS: process.env.API_TIMEOUT_MS ? parseInt(process.env.API_TIMEOUT_MS) : undefined,
        API_RETRY_ATTEMPTS: process.env.API_RETRY_ATTEMPTS ? parseInt(process.env.API_RETRY_ATTEMPTS) : undefined,
        API_RETRY_DELAY_MS: process.env.API_RETRY_DELAY_MS ? parseInt(process.env.API_RETRY_DELAY_MS) : undefined,
        API_RETRY_MAX_DELAY_MS: process.env.API_RETRY_MAX_DELAY_MS ? parseInt(process.env.API_RETRY_MAX_DELAY_MS) : undefined,
        
        SCHEMA_PATH: process.env.SCHEMA_PATH,
      };

      return ConfigSchema.parse(rawConfig);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error('Configuration validation failed:', error.errors);
        throw new Error(`Invalid configuration: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      throw error;
    }
  }

  get config(): Config {
    return { ...this.configData };
  }

  get<K extends keyof Config>(key: K): Config[K] {
    return this.configData[key];
  }

  isProduction(): boolean {
    return this.configData.NODE_ENV === 'production';
  }

  isDevelopment(): boolean {
    return this.configData.NODE_ENV === 'development';
  }

  isTest(): boolean {
    return this.configData.NODE_ENV === 'test';
  }
}

// Export a singleton instance for easy access
export const config = ConfigManager.getInstance().config;