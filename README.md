# Elasticsearch MCP Server

A Model Context Protocol (MCP) server for Elasticsearch integration with multi-team and multi-environment support. This server allows AI assistants to search exceptions, analyze patterns, and query logs across different teams and environments in a secure and organized way.

## Features

- **Multi-Team Support**: Configure multiple teams with their own Elasticsearch clusters
- **Multi-Environment Support**: Support for development, staging, production environments per team
- **Exception Search**: Flexible exception search with filtering and frequency sorting
- **Exception Analysis**: Deep analysis of specific exceptions with cause and solution suggestions
- **Trend Analysis**: Analyze exception patterns, frequency trends, and service health
- **Log Search**: Search application logs with various filters
- **Connection Testing**: Test Elasticsearch connections for teams and environments
- **Flexible Authentication**: Support for API keys and username/password authentication
- **HTTP and STDIO Transport**: Support for both HTTP+SSE and STDIO transport protocols

## Installation

```bash
npm install
```

## Configuration

### Environment Variables

- `LOG_LEVEL`: Logging level (default: `info`) - handled directly by the logger
- `HTTP_PATH_PREFIX`: HTTP path prefix (default: `/`)
- `TEAMS_CONFIG_PATH`: Path to teams configuration file (optional)
- `PORT`: HTTP server port (default: `3000`)

### Teams Configuration

Create a `teams-config.json` file based on `teams-config.example.json`:

```json
{
  "server": {
    "name": "elasticsearch-mcp",
    "version": "1.0.0"
  },
  "teams": {
    "team-alpha": {
      "teamId": "team-alpha",
      "teamName": "Team Alpha",
      "defaultEnvironment": "production",
      "environments": {
        "staging": {
          "node": "https://alpha-staging-es.company.com",
          "apiKey": "your-api-key"
        },
        "production": {
          "node": "https://alpha-prod-es.company.com",
          "apiKey": "your-api-key"
        }
      },
      "indexPatterns": {
        "exceptions": ["alpha-logs-*", "alpha-exceptions-*"],
        "applications": ["alpha-apm-*", "alpha-metrics-*"],
        "logs": ["alpha-app-logs-*"]
      },
      "maxSearchResults": 50,
      "allowedOperations": ["search_exceptions", "analyze_exception", "analyze_trends", "search_logs", "test_connection"]
    }
  }
}
```

#### Configuration Options

- **teamId**: Unique identifier for the team
- **teamName**: Human-readable team name
- **defaultEnvironment**: Default environment to use when none specified
- **environments**: Elasticsearch connection configurations per environment
  - **node**: Elasticsearch cluster URL
  - **apiKey**: API key for authentication (optional)
  - **username/password**: Basic authentication (optional)
  - **maxRetries**: Maximum retry attempts (default: 3)
  - **requestTimeout**: Request timeout in milliseconds (default: 30000)
- **indexPatterns**: Index patterns for different data types
  - **exceptions**: Patterns for exception/error logs
  - **applications**: Patterns for application metrics/APM data
  - **logs**: Patterns for general application logs
- **maxSearchResults**: Maximum number of results to return (default: 50)
- **allowedOperations**: List of allowed operations for this team (optional)

## Usage

### STDIO Mode (for MCP clients)

```bash
npm run dev
# or
npm start
```

### HTTP Mode (for web interfaces)

```bash
npm run start-http
# or
npm run dev -- --http
```

The HTTP server will be available at:

- SSE endpoint: `GET http://localhost:3000/sse`
- Messages endpoint: `POST http://localhost:3000/messages`
- Health check: `GET http://localhost:3000/health`

## Available Tools

### 1. `search_exceptions` 🔍

Flexible exception search with advanced filtering and sorting capabilities.

**Parameters:**
- `environment` (optional): The environment to search in
- `message` (optional): Filter by exception message content
- `query` (optional): Search term for exception message or stack trace
- `service` (optional): Filter by service name
- `severity` (optional): Filter by log severity level
- `timeRange` (optional): Custom time range
  - `start`: Start time in ISO format
  - `end`: End time in ISO format
- `timeframe` (optional): Predefined time frame (`1h`, `6h`, `12h`, `24h`, `7d`)
- `limit` (optional): Number of results to return (default: 20, max: 100)
- `sortByFrequency` (optional): Sort by frequency (most frequent first)

**Use Cases:**
- "Welche Exceptions passen zu diesem Commit/Pull Request?"
- "Zeige mir alle Database-Exceptions der letzten 6 Stunden"
- "Finde die häufigsten Exceptions im User-Service"

### 2. `analyze_exception` 🔬

Deep analysis of a specific exception with causes and solution suggestions.

**Parameters:**
- `environment` (optional): The environment to analyze
- `exceptionMessage` (required): The specific exception message to analyze
- `timeframe` (optional): Time frame for analysis (default: `24h`)

**Use Cases:**
- "Analysiere diese Exception: 'NullPointerException in UserService'"
- "Was ist die Ursache für 'Connection timeout' Fehler?"

### 3. `analyze_trends` 📈

Analyze exception patterns, frequency trends, and service health over time.

**Parameters:**
- `environment` (optional): The environment to analyze
- `timeRange` (optional): Custom time range for analysis
- `timeframe` (optional): Predefined time frame (default: `24h`)
- `analysisType` (optional): Type of analysis (`exceptions`, `services`, `both`)
- `services` (optional): List of specific services to analyze

**Use Cases:**
- "Welche Exceptions sind in den letzten 24h häufiger aufgetreten?"
- "Welche Services werfen in letzter Zeit mehr Exceptions?"
- "Zeige mir die Exception-Trends für das Payment-System"

### 4. `search_logs` 📋

Search general application logs with filtering capabilities.

**Parameters:**
- `environment` (optional): The environment to search in
- `message` (optional): Filter by log message content
- `service` (optional): Filter by service name
- `timeRange` (optional): Time range for search (defaults to last 1 hour)

**Use Cases:**
- "Zeige mir alle Logs vom User-Service der letzten Stunde"
- "Suche nach Logs mit 'payment failed'"

### 5. `test_connection` 🔌

Test Elasticsearch connection for a team and environment.

**Parameters:**
- `environment` (optional): The environment to test

**Use Cases:**
- "Teste die Verbindung zu Production"
- "Ist Elasticsearch erreichbar?"

## 🚀 Common Prompts & Use Cases

### Exception Investigation
```
"Welche Exceptions sind in den letzten 24h häufiger aufgetreten?"
→ Uses: analyze_trends with analysisType="exceptions"

"Mir ist diese Exception 'OutOfMemoryError' aufgefallen, finde mehr über sie heraus"
→ Uses: analyze_exception with exceptionMessage="OutOfMemoryError"

"Welche Exceptions passen zu diesem API-Endpoint /users/profile?"
→ Uses: search_exceptions with query="/users/profile"
```

### Service Health Monitoring
```
"Welche Services werfen in letzter Zeit mehr Exceptions?"
→ Uses: analyze_trends with analysisType="services"

"Zeige mir alle Exceptions vom Payment-Service der letzten 6 Stunden"
→ Uses: search_exceptions with service="payment-service" and timeframe="6h"
```

### Debugging & Troubleshooting
```
"Suche nach Database-Connection-Errors der letzten 24h"
→ Uses: search_exceptions with query="database connection" and timeframe="24h"

"Analysiere die häufigsten Exceptions im User-Service"
→ Uses: search_exceptions with service="user-service" and sortByFrequency=true
```

## 🛠️ Development

### Code Quality

This project maintains high code quality standards:

```bash
# Run all quality checks
npm run check

# Individual checks
npm run typecheck    # TypeScript type checking
npm run lint         # ESLint code analysis
npm run format:check # Prettier formatting check

# Auto-fix issues
npm run lint:fix     # Fix ESLint issues
npm run format       # Format code with Prettier
```

### Building

```bash
# Build the project
npm run build

# Clean build artifacts
npm run clean
```

### Scripts Overview

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm run start` - Build and start production server
- `npm run cli` - Run the CLI tool
- `npm run check` - Run all quality checks

## Architecture

The server is built with a modular architecture:

- **ConfigManager**: Handles team configuration loading and validation
- **ElasticsearchService**: Manages Elasticsearch connections and queries
- **MCP Tools**: Individual tools for different operations (5 optimized tools)
- **HTTP Server**: Provides HTTP+SSE transport for web interfaces
- **STDIO Transport**: Provides STDIO transport for MCP clients

### Tool Design Philosophy

The tools are designed with these principles:
- **Short, memorable names** (11-17 characters)
- **Clear separation of concerns** (search vs. analyze vs. trends)
- **Flexible parameters** to support various use cases
- **No functional duplication** between tools

## Security Considerations

- Store sensitive credentials (API keys, passwords) securely
- Use environment variables for sensitive configuration
- Consider network security for Elasticsearch connections
- Implement proper access controls per team
- Use the `allowedOperations` configuration to restrict team capabilities

## Error Handling

The server includes comprehensive error handling:

- Configuration validation on startup
- Connection error handling with retries
- Graceful degradation for unavailable services
- Detailed logging for troubleshooting

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Run linting and formatting
6. Submit a pull request
