import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import https from 'https';
import { Config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { ArgoAPIError, TimeoutError, AuthenticationError } from '../utils/errors.js';
import { RetryStrategy } from '../utils/retry.js';

const logger = createLogger('ArgoClient');

export interface ArgoClientOptions {
  config: Config;
  retryStrategy?: RetryStrategy;
}

export class ArgoClient {
  private readonly client: AxiosInstance;
  private readonly retryStrategy: RetryStrategy;

  constructor(options: ArgoClientOptions) {
    const { config, retryStrategy } = options;

    this.retryStrategy = retryStrategy || new RetryStrategy({
      maxAttempts: config.API_RETRY_ATTEMPTS,
      initialDelayMs: config.API_RETRY_DELAY_MS,
      maxDelayMs: config.API_RETRY_MAX_DELAY_MS,
    });

    // Create axios instance with production config
    this.client = axios.create({
      baseURL: config.ARGO_SERVER_URL,
      timeout: config.API_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'argo-mcp-server/1.0.0',
        ...(config.ARGO_TOKEN && { Authorization: `${config.ARGO_TOKEN}` }),
      },
      httpsAgent: new https.Agent({
        rejectUnauthorized: !config.ARGO_INSECURE_SKIP_VERIFY,
      }),
      validateStatus: () => true, // Handle all status codes
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        const requestId = this.generateRequestId();
        config.headers['X-Request-ID'] = requestId;
        
        logger.debug('Outgoing request', {
          method: config.method,
          url: config.url,
          requestId,
        });

        return config;
      },
      (error) => {
        logger.error('Request interceptor error', { error });
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => {
        const requestId = response.config.headers?.['X-Request-ID'];
        
        logger.debug('Response received', {
          status: response.status,
          requestId,
          url: response.config.url,
        });

        return response;
      },
      (error: AxiosError) => {
        const requestId = error.config?.headers?.['X-Request-ID'];
        
        logger.error('Response error', {
          error: error.message,
          status: error.response?.status,
          requestId,
          url: error.config?.url,
        });

        return Promise.reject(error);
      }
    );
  }

  async request<T = any>(config: AxiosRequestConfig): Promise<T> {
    try {
      // Execute request with retry
      const response = await this.retryStrategy.execute(async () => {
        const result = await this.client.request<T>(config);

        // Handle non-2xx status codes
        if (result.status >= 400) {
          throw this.handleAPIError(result);
        }

        return result;
      });

      return response.data;
    } catch (error) {
      throw this.transformError(error);
    }
  }

  // Convenience methods
  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'GET', url });
  }

  async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'POST', url, data });
  }

  async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'PUT', url, data });
  }

  async patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'PATCH', url, data });
  }

  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'DELETE', url });
  }

  // Health check
  async healthCheck(): Promise<{ healthy: boolean; version?: string; details?: any }> {
    try {
      const response = await this.get('/api/v1/version');
      return {
        healthy: true,
        version: response.version,
        details: response,
      };
    } catch (error) {
      logger.error('Health check failed', { error });
      return {
        healthy: false,
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private handleAPIError(response: any): Error {
    const { status, statusText, data, config } = response;

    // Handle specific status codes
    switch (status) {
      case 401:
        return new AuthenticationError('Invalid or expired token', {
          endpoint: config.url,
        });
      case 403:
        return new AuthenticationError('Insufficient permissions', {
          endpoint: config.url,
        });
      case 404:
        return new ArgoAPIError(`Resource not found: ${config.url}`, status, data);
      case 429:
        const retryAfter = response.headers['retry-after'];
        return new ArgoAPIError(
          'Rate limit exceeded',
          status,
          data,
          { retryAfter }
        );
      default:
        return new ArgoAPIError(
          data?.message || statusText || 'API request failed',
          status,
          data,
          { endpoint: config.url }
        );
    }
  }

  private transformError(error: unknown): Error {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') {
        return new TimeoutError('API request', error.config?.timeout || 0);
      }
      if (error.response) {
        return this.handleAPIError(error.response);
      }
      return ArgoAPIError.fromAxiosError(error);
    }
    
    if (error instanceof Error) {
      return error;
    }

    return new Error(String(error));
  }

  private generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}