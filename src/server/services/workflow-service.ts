import { ArgoClient } from '../../client/argo-client.js';
import { Config } from '../../config/index.js';
import { createLogger } from '../../utils/logger.js';
import { ValidationError } from '../../utils/errors.js';

const logger = createLogger('WorkflowService');

export interface ListWorkflowsOptions {
  namespace?: string;
  labelSelector?: string;
  fieldSelector?: string;
  limit?: number;
  continue?: string;
  offset?: number;
  phase?: string | string[];
  createdAfter?: Date | string;
  createdBefore?: Date | string;
  startedAfter?: Date | string;
  startedBefore?: Date | string;
  finishedAfter?: Date | string;
  finishedBefore?: Date | string;
  name?: string;
  namePrefix?: string;
  status?: string;
  sortBy?: 'name' | 'creationTimestamp' | 'startedAt' | 'finishedAt' | 'phase';
  sortOrder?: 'asc' | 'desc';
  includeCompleted?: boolean;
  resourceVersion?: string;
}

export interface WorkflowSummary {
  metadata: {
    name: string;
    namespace: string;
    creationTimestamp: string;
    labels?: Record<string, string>;
  };
  status: {
    phase: string;
    startedAt?: string;
    finishedAt?: string;
    message?: string;
    progress?: string;
  };
}

export class ArgoWorkflowService {
  constructor(
    private readonly client: ArgoClient,
    private readonly config: Config
  ) {}

  async listWorkflows(options: ListWorkflowsOptions = {}): Promise<{
    items: WorkflowSummary[];
    metadata: { 
      continue?: string; 
      remainingItemCount?: number;
      totalCount?: number;
      resourceVersion?: string;
    };
  }> {
    const namespace = options.namespace || this.config.ARGO_NAMESPACE;
    const params: Record<string, any> = {};

    // Pagination parameters
    if (options.limit !== undefined) {
      params.limit = Math.min(options.limit, 1000); // Cap at 1000 for safety
    } else {
      params.limit = 100; // Default
    }

    if (options.continue) {
      params.continue = options.continue;
    }

    if (options.offset !== undefined) {
      params.offset = options.offset;
    }

    // Label and field selectors
    if (options.labelSelector) {
      params.labelSelector = options.labelSelector;
    }

    // Build field selector
    const fieldSelectors: string[] = [];
    
    if (options.fieldSelector) {
      fieldSelectors.push(options.fieldSelector);
    }

    if (options.phase) {
      const phases = Array.isArray(options.phase) ? options.phase : [options.phase];
      fieldSelectors.push(`status.phase in (${phases.join(',')})`);
    }

    if (options.name) {
      fieldSelectors.push(`metadata.name=${options.name}`);
    }

    if (options.namePrefix) {
      fieldSelectors.push(`metadata.name=${options.namePrefix}*`);
    }

    if (options.status) {
      fieldSelectors.push(`status.phase=${options.status}`);
    }

    if (fieldSelectors.length > 0) {
      params.fieldSelector = fieldSelectors.join(',');
    }

    // Time-based filters
    if (options.createdAfter) {
      params.createdAfter = this.formatDate(options.createdAfter);
    }

    if (options.createdBefore) {
      params.createdBefore = this.formatDate(options.createdBefore);
    }

    if (options.startedAfter) {
      params.startedAfter = this.formatDate(options.startedAfter);
    }

    if (options.startedBefore) {
      params.startedBefore = this.formatDate(options.startedBefore);
    }

    if (options.finishedAfter) {
      params.finishedAfter = this.formatDate(options.finishedAfter);
    }

    if (options.finishedBefore) {
      params.finishedBefore = this.formatDate(options.finishedBefore);
    }

    // Sorting
    if (options.sortBy) {
      const sortFields: Record<string, string> = {
        name: 'metadata.name',
        creationTimestamp: 'metadata.creationTimestamp',
        startedAt: 'status.startedAt',
        finishedAt: 'status.finishedAt',
        phase: 'status.phase',
      };
      
      const sortField = sortFields[options.sortBy] || options.sortBy;
      const sortOrder = options.sortOrder || 'desc';
      params.sort = `${sortOrder === 'asc' ? '' : '-'}${sortField}`;
    }

    // Other options
    if (options.includeCompleted !== undefined) {
      params.includeCompleted = options.includeCompleted;
    }

    if (options.resourceVersion) {
      params.resourceVersion = options.resourceVersion;
    }

    logger.debug('Listing workflows', { namespace, params });

    const response = await this.client.get(
      `/api/v1/workflows/${namespace}`,
      { params }
    );

    // Transform to summary format
    const items = response.items?.map((workflow: any) => ({
      metadata: {
        name: workflow.metadata.name,
        namespace: workflow.metadata.namespace,
        creationTimestamp: workflow.metadata.creationTimestamp,
        labels: workflow.metadata.labels,
      },
      status: {
        phase: workflow.status?.phase || 'Unknown',
        startedAt: workflow.status?.startedAt,
        finishedAt: workflow.status?.finishedAt,
        message: workflow.status?.message,
        progress: workflow.status?.progress,
      },
    })) || [];

    return {
      items,
      metadata: {
        continue: response.metadata?.continue,
        remainingItemCount: response.metadata?.remainingItemCount,
        totalCount: response.metadata?.totalCount,
        resourceVersion: response.metadata?.resourceVersion,
      },
    };
  }

  private formatDate(date: Date | string): string {
    if (typeof date === 'string') {
      return date;
    }
    return date.toISOString();
  }

  async getWorkflow(namespace: string, name: string): Promise<any> {
    if (!namespace || !name) {
      throw new ValidationError('Namespace and name are required');
    }

    logger.debug('Getting workflow', { namespace, name });

    return this.client.get(`/api/v1/workflows/${namespace}/${name}`);
  }

  async getWorkflowLogs(
    namespace: string,
    name: string,
    podName?: string,
    container: string = 'main',
    follow: boolean = false
  ): Promise<string> {
    if (!namespace || !name) {
      throw new ValidationError('Namespace and name are required');
    }

    const params: Record<string, any> = {
      container,
      follow: follow ? 'true' : 'false',
    };

    if (podName) {
      params.podName = podName;
    }

    logger.debug('Getting workflow logs', { namespace, name, params });

    try {
      const response = await this.client.get(
        `/api/v1/workflows/${namespace}/${name}/log`,
        { params }
      );

      // The response might be a string or an object with the logs
      if (typeof response === 'string') {
        return response;
      } else if (response.result) {
        return response.result;
      } else {
        return JSON.stringify(response, null, 2);
      }
    } catch (error) {
      logger.error('Failed to get workflow logs', { error, namespace, name });
      throw error;
    }
  }

  async submitWorkflow(
    namespace: string,
    templateName: string,
    parameters?: Record<string, any>,
    labels?: Record<string, string>
  ): Promise<any> {
    if (!namespace || !templateName) {
      throw new ValidationError('Namespace and template name are required');
    }

    logger.debug('Submitting workflow', { namespace, templateName, parameters });

    // Build workflow submission request
    const workflowRequest = {
      workflow: {
        metadata: {
          generateName: `${templateName}-`,
          namespace,
          labels: {
            'workflows.argoproj.io/workflow-template': templateName,
            ...labels,
          },
        },
        spec: {
          workflowTemplateRef: {
            name: templateName,
          },
          arguments: parameters ? {
            parameters: Object.entries(parameters).map(([name, value]) => ({
              name,
              value: String(value),
            })),
          } : undefined,
        },
      },
    };

    return this.client.post(
      `/api/v1/workflows/${namespace}/submit`,
      workflowRequest
    );
  }

  async retryWorkflow(namespace: string, name: string): Promise<any> {
    if (!namespace || !name) {
      throw new ValidationError('Namespace and name are required');
    }

    logger.debug('Retrying workflow', { namespace, name });

    return this.client.put(
      `/api/v1/workflows/${namespace}/${name}/retry`,
      {}
    );
  }

  async terminateWorkflow(namespace: string, name: string, reason?: string): Promise<any> {
    if (!namespace || !name) {
      throw new ValidationError('Namespace and name are required');
    }

    logger.debug('Terminating workflow', { namespace, name, reason });

    const request = {
      namespace,
      name,
      terminateWorkflowRequest: {
        reason: reason || 'Terminated by MCP server',
      },
    };

    return this.client.put(
      `/api/v1/workflows/${namespace}/${name}/terminate`,
      request
    );
  }

  async deleteWorkflow(namespace: string, name: string): Promise<any> {
    if (!namespace || !name) {
      throw new ValidationError('Namespace and name are required');
    }

    logger.debug('Deleting workflow', { namespace, name });

    return this.client.delete(`/api/v1/workflows/${namespace}/${name}`);
  }

  async getWorkflowTemplate(namespace: string, name: string): Promise<any> {
    if (!namespace || !name) {
      throw new ValidationError('Namespace and name are required');
    }

    logger.debug('Getting workflow template', { namespace, name });

    return this.client.get(`/api/v1/workflow-templates/${namespace}/${name}`);
  }

  async listWorkflowTemplates(namespace?: string): Promise<any> {
    const ns = namespace || this.config.ARGO_NAMESPACE;
    
    logger.debug('Listing workflow templates', { namespace: ns });

    return this.client.get(`/api/v1/workflow-templates/${ns}`);
  }

  // Helper methods for common queries
  async getRecentWorkflows(
    namespace?: string, 
    limit: number = 10
  ): Promise<{ items: WorkflowSummary[]; metadata: any }> {
    return this.listWorkflows({
      namespace,
      limit,
      sortBy: 'creationTimestamp',
      sortOrder: 'desc',
    });
  }

  async getFailedWorkflows(
    namespace?: string,
    since?: Date | string,
    limit: number = 100
  ): Promise<{ items: WorkflowSummary[]; metadata: any }> {
    return this.listWorkflows({
      namespace,
      limit,
      phase: 'Failed',
      finishedAfter: since,
      sortBy: 'finishedAt',
      sortOrder: 'desc',
    });
  }

  async getRunningWorkflows(
    namespace?: string,
    limit: number = 100
  ): Promise<{ items: WorkflowSummary[]; metadata: any }> {
    return this.listWorkflows({
      namespace,
      limit,
      phase: 'Running',
      sortBy: 'startedAt',
      sortOrder: 'desc',
    });
  }

  async searchWorkflowsByName(
    namePattern: string,
    namespace?: string,
    limit: number = 100
  ): Promise<{ items: WorkflowSummary[]; metadata: any }> {
    return this.listWorkflows({
      namespace,
      limit,
      namePrefix: namePattern,
      sortBy: 'name',
      sortOrder: 'asc',
    });
  }

  async getWorkflowsByLabel(
    labels: Record<string, string>,
    namespace?: string,
    limit: number = 100
  ): Promise<{ items: WorkflowSummary[]; metadata: any }> {
    const labelSelector = Object.entries(labels)
      .map(([key, value]) => `${key}=${value}`)
      .join(',');
    
    return this.listWorkflows({
      namespace,
      limit,
      labelSelector,
    });
  }

  async *paginateWorkflows(
    options: ListWorkflowsOptions,
    pageSize: number = 50
  ): AsyncGenerator<WorkflowSummary[], void, unknown> {
    let continueToken: string | undefined;
    
    do {
      const result = await this.listWorkflows({
        ...options,
        limit: pageSize,
        continue: continueToken,
      });
      
      yield result.items;
      continueToken = result.metadata.continue;
    } while (continueToken);
  }
}