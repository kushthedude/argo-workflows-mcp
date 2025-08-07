# Argo Workflows MCP Server

A production-ready [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that provides AI agents with comprehensive access to [Argo Workflows](https://argoproj.github.io/workflows/). This server enables AI assistants to interact with Kubernetes-based workflow orchestration through a standardized protocol.

## 🚀 Features

### Core Capabilities
- **Complete Argo Workflows API Access**: Full integration with Argo Workflows REST API
- **Auto-generated Tools**: Dynamic tool generation from OpenAPI schema
- **Custom High-level Operations**: Convenient abstractions for common workflow tasks
- **Production-ready**: Built with security, reliability, and performance in mind

### Workflow Operations
- List, filter, and search workflows with advanced options
- Submit workflows from templates with parameters
- Monitor workflow status and progress
- Retrieve detailed workflow information and logs
- Retry failed workflows
- Terminate running workflows
- Manage workflow templates

### Advanced Features
- **Comprehensive Filtering**: Filter by phase, labels, dates, names, and custom field selectors
- **Pagination Support**: Handle large result sets efficiently
- **Time-based Queries**: Find workflows by creation, start, or finish times
- **Label-based Search**: Query workflows using Kubernetes label selectors
- **Real-time Monitoring**: Health checks and status monitoring
- **Secure Authentication**: Bearer token authentication with configurable security

## 📋 Prerequisites

- **Node.js**: Version 18.0.0 or higher
- **Argo Workflows**: Access to an Argo Workflows server
- **Kubernetes**: Cluster with Argo Workflows installed
- **Network Access**: Connectivity to your Argo server

## 🛠️ Installation

### From Source

```bash
# Clone the repository
git clone https://github.com/your-org/argo-workflows-mcp-server.git
cd argo-workflows-mcp-server

# Install dependencies
npm install

# Build the project
npm run build

# Start the server
npm start
```

### Using Docker

```bash
# Build the Docker image
npm run docker:build

# Run with environment file
npm run docker:run
```

## ⚙️ Configuration

Configure the server using environment variables. Create a `.env` file:

```env
# Required: Argo Server Configuration
ARGO_SERVER_URL=https://your-argo-server.example.com
ARGO_TOKEN=your-bearer-token
ARGO_NAMESPACE=default

# Optional: Server Configuration
NODE_ENV=production
LOG_LEVEL=info
LOG_FORMAT=json

# Optional: HTTP Transport
HTTP_PORT=8080
HTTP_HOST=127.0.0.1
HTTP_PATH=/mcp
HTTP_AUTH_TOKEN=your-secret-token
HTTP_VALIDATE_ORIGIN=true

# Optional: API Configuration
API_TIMEOUT_MS=30000
API_RETRY_ATTEMPTS=3
API_RETRY_DELAY_MS=1000

# Optional: Security
ARGO_INSECURE_SKIP_VERIFY=false
```

### Configuration Options

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `ARGO_SERVER_URL` | Argo Workflows server URL | - | ✅ |
| `ARGO_TOKEN` | Bearer token for authentication | - | ⚠️ |
| `ARGO_NAMESPACE` | Default namespace for operations | `default` | ❌ |
| `HTTP_PORT` | Server port | `8080` | ❌ |
| `HTTP_HOST` | Server host | `127.0.0.1` | ❌ |
| `HTTP_AUTH_TOKEN` | API authentication token | - | ❌ |
| `LOG_LEVEL` | Logging level | `info` | ❌ |
| `API_TIMEOUT_MS` | Request timeout | `30000` | ❌ |

## 🔧 Usage

### With MCP-compatible AI Assistants

Add the server to your MCP client configuration:

```json
{
  "mcpServers": {
    "argo-workflows": {
      "command": "node",
      "args": ["path/to/argo-workflows-mcp-server/dist/index.js"],
      "env": {
        "ARGO_SERVER_URL": "https://your-argo-server.example.com",
        "ARGO_TOKEN": "your-bearer-token"
      }
    }
  }
}
```

### Available Tools

#### Workflow Management
- `list_workflows` - List workflows with advanced filtering and pagination
- `get_workflow` - Get detailed workflow information
- `submit_workflow` - Submit new workflow from template
- `retry_workflow` - Retry a failed workflow
- `terminate_workflow` - Terminate a running workflow

#### Monitoring & Queries
- `get_recent_workflows` - Get recently created workflows
- `get_failed_workflows` - Find failed workflows
- `get_running_workflows` - List currently running workflows
- `search_workflows_by_name` - Search by name pattern
- `get_workflows_by_label` - Query by labels

#### Logs & Diagnostics
- `workflow_logs` - Retrieve workflow execution logs
- `health_check` - Check Argo server connectivity

#### Auto-generated API Tools
Additional tools are automatically generated from the Argo Workflows OpenAPI specification, providing access to the complete API surface.

### Example Queries

Ask your AI assistant:

- "Show me all failed workflows from the last 24 hours"
- "List running workflows in the production namespace"
- "Get logs for workflow my-workflow-abc123"
- "Submit a new workflow using the data-processing template"
- "Find workflows with label environment=staging"

## 🏗️ Development

### Scripts

```bash
# Development with hot reload
npm run dev

# Type checking
npm run typecheck

# Linting
npm run lint

# Formatting
npm run format

# Testing
npm test
npm run test:watch
npm run test:coverage
```

### Project Structure

```
src/
├── client/           # Argo API client
├── config/           # Configuration management
├── schema/           # OpenAPI schema parsing
├── server/           # MCP server implementation
│   └── services/     # Business logic services
├── utils/            # Utilities (logging, errors, etc.)
└── index.ts          # Application entry point
```

## 🔒 Security

### Authentication
- Bearer token authentication for Argo server
- Optional HTTP authentication for MCP endpoints
- DNS rebinding protection
- Origin validation

### Best Practices
- Use HTTPS in production
- Rotate authentication tokens regularly
- Limit network access to necessary services
- Enable comprehensive logging

## 🐳 Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/
COPY schema/ ./schema/

EXPOSE 8080
CMD ["node", "dist/index.js"]
```

## 📊 Monitoring

The server provides comprehensive logging and health checking:

- Structured JSON logging
- Health check endpoint
- Request/response tracing
- Error tracking with context

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes and add tests
4. Ensure all tests pass: `npm test`
5. Commit your changes: `git commit -m 'Add amazing feature'`
6. Push to the branch: `git push origin feature/amazing-feature`
7. Open a Pull Request

### Development Guidelines
- Follow TypeScript best practices
- Add tests for new functionality
- Update documentation for API changes
- Use conventional commit messages

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Argo Workflows](https://argoproj.github.io/workflows/) - Kubernetes-native workflow engine
- [Model Context Protocol](https://modelcontextprotocol.io) - Standardized protocol for AI tool integration
- [Anthropic](https://www.anthropic.com) - MCP specification and tooling

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/your-org/argo-workflows-mcp-server/issues)
- **Documentation**: [Wiki](https://github.com/your-org/argo-workflows-mcp-server/wiki)
- **Discussions**: [GitHub Discussions](https://github.com/your-org/argo-workflows-mcp-server/discussions)

## 🗺️ Roadmap

- [ ] WebSocket support for real-time updates
- [ ] Workflow template management tools
- [ ] Metrics and observability integration
- [ ] Cluster resource monitoring
- [ ] Workflow visualization data
- [ ] Advanced workflow scheduling
- [ ] Multi-cluster support 