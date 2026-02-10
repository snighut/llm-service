# Agent Module - Quick Start Guide

## Overview

The Agent Module enables automated system design generation using AI. When users provide natural language descriptions, the agent automatically creates complete system architecture diagrams with components and connections.

## Architecture

```
POST /agent/generate-design
      ↓
  Agent Service (orchestrates LLM + tools)
      ↓
  DesignTools Service (calls design-service APIs)
      ↓
  Design Service (stores in PostgreSQL)
```

## Installation

### 1. Install Required Dependencies

```bash
npm install langchain zod
```

These packages are needed for:
- `langchain`: Agent framework and tool calling
- `zod`: Schema validation for tool parameters

### 2. Environment Configuration

Add these variables to your `.env` file:

```bash
# Design Service Configuration
DESIGN_SERVICE_URL=http://localhost:3000
# or in Kubernetes: http://design-service:3000

# Ollama Configuration (already present)
OLLAMA_HOST=http://your-ubuntu-server:11434
OLLAMA_MODEL=mistral-nemo:latest

# Agent Configuration (optional)
AGENT_MAX_ITERATIONS=15
AGENT_TIMEOUT_MS=60000
AGENT_ENABLE_WEB_SEARCH=false
```

### 3. Verify Design Service Compatibility

Ensure your design-service has these endpoints:
- `GET /designs` - List all designs (for searching)
- `GET /designs/:id` - Get design with items and connections
- `POST /designs` - Create design with items and connections

The POST endpoint should accept this structure:
```json
{
  "name": "Design Name",
  "description": "Description",
  "items": [
    {
      "name": "Component Name",
      "type": "service|database|queue|cache|gateway|frontend|backend",
      "uidata": { "x": 100, "y": 100 },
      "context": {}
    }
  ],
  "connections": [
    {
      "from": { "name": "Source", "type": "DesignItem" },
      "to": { "name": "Target", "type": "DesignItem" },
      "name": "Connection Label",
      "context": {}
    }
  ]
}
```

## Usage

### Starting the Service

```bash
# Development mode
npm run start:dev

# Production mode
npm run build
npm run start:prod
```

### API Endpoints

#### Generate Design

```bash
POST http://localhost:3001/agent/generate-design
Content-Type: application/json

{
  "query": "Design a microservices architecture for an e-commerce platform with payment processing and order management",
  "options": {
    "useTemplates": true,
    "enableWebSearch": false,
    "maxComponents": 20
  }
}
```

**Response:**
```json
{
  "designId": "uuid-of-created-design",
  "name": "E-commerce Microservices Architecture",
  "message": "Design created successfully",
  "reasoning": [
    "Used tool: search_existing_designs with input: {\"query\":\"microservices ecommerce\"}",
    "Result: Found 2 matching designs...",
    "Used tool: create_system_design with input: {...}",
    "Result: {\"success\":true,\"designId\":\"...\"}"
  ],
  "metadata": {
    "componentsCount": 8,
    "connectionsCount": 12,
    "processingTimeMs": 3421,
    "templateUsed": true
  }
}
```

#### Health Check

```bash
GET http://localhost:3001/agent/health
```

**Response:**
```json
{
  "service": "agent",
  "status": "healthy",
  "model": "mistral-nemo:latest",
  "timestamp": "2026-02-09T10:30:00.000Z"
}
```

## Example Queries

### Simple Architectures
```
"Design a REST API with PostgreSQL database"
"Create a web application with authentication"
"Design a simple CRUD service"
```

### Microservices
```
"Design a microservices architecture for an e-commerce platform"
"Create an event-driven microservices system with message queues"
"Design a scalable video streaming platform"
```

### Complex Systems
```
"Design a real-time chat application with Redis cache and WebSocket support"
"Create a CI/CD pipeline architecture with multiple environments"
"Design a multi-tenant SaaS platform with separate databases"
```

## How It Works

1. **Query Analysis**: Agent analyzes user intent and extracts requirements
2. **Template Search**: Searches existing designs for similar patterns using `search_existing_designs` tool
3. **Template Analysis**: If found, fetches full design structure using `get_design_by_id` tool
4. **Design Planning**: Plans components and connections based on requirements and templates
5. **Design Creation**: Creates the design using `create_system_design` tool
6. **Response**: Returns design ID and metadata to collaboration-app

## Tools Available to Agent

### 1. search_existing_designs
- **Purpose**: Find similar designs in database
- **Input**: `{ query: string }`
- **Output**: Array of matching designs with IDs and names

### 2. get_design_by_id
- **Purpose**: Fetch complete design structure
- **Input**: `{ designId: string }`
- **Output**: Design with all items and connections

### 3. create_system_design
- **Purpose**: Create new design
- **Input**: `{ name, description, items[], connections[] }`
- **Output**: `{ success, designId, itemsCount, connectionsCount }`

## Troubleshooting

### Issue: "Failed to connect to design-service"

**Solution**: Verify design-service is running and DESIGN_SERVICE_URL is correct
```bash
curl http://localhost:3000/designs
```

### Issue: "Agent failed to create design"

**Cause**: LLM might not be returning proper tool calls

**Solution**: 
1. Check Ollama is running: `curl http://your-ubuntu:11434/api/tags`
2. Verify model supports tool calling (mistral-nemo does)
3. Check agent logs for detailed error messages

### Issue: "Design created but layout is wrong"

**Cause**: Auto-layout algorithm needs tuning

**Solution**: Modify `generateLayout()` in `design-tools.service.ts`:
```typescript
const SPACING_X = 300; // Increase spacing
const SPACING_Y = 250;
const ITEMS_PER_ROW = 3; // Fewer items per row
```

### Issue: "Agent taking too long to respond"

**Cause**: Multiple tool calls or slow LLM inference

**Solution**:
1. Reduce `AGENT_MAX_ITERATIONS` in code
2. Use a faster model or increase LLM resources
3. Add timeout handling in agent.service.ts

## Development

### Adding New Tools

1. Create tool in `design-tools.service.ts`:
```typescript
getMyNewTool(): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'my_tool',
    description: 'What this tool does',
    schema: z.object({
      param: z.string().describe('Parameter description'),
    }),
    func: async ({ param }) => {
      // Implementation
      return JSON.stringify(result);
    },
  });
}
```

2. Add to `getAllTools()` method
3. Update agent system prompt to describe the new tool

### Testing Locally

```bash
# Terminal 1: Start design-service
cd design-service
npm run start:dev

# Terminal 2: Start llm-service
cd llm-service
npm run start:dev

# Terminal 3: Test agent
curl -X POST http://localhost:3001/agent/generate-design \
  -H "Content-Type: application/json" \
  -d '{"query":"Design a simple API with database"}'
```

## Integration with Collaboration-App

To integrate with your Next.js frontend:

```typescript
// In collaboration-app
async function generateDesign(prompt: string) {
  const response = await fetch('http://llm-service:3001/agent/generate-design', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: prompt }),
  });
  
  const result = await response.json();
  
  // Fetch the created design
  const design = await fetch(`http://design-service:3000/designs/${result.designId}`);
  return await design.json();
}
```

## Performance Optimization

### Caching
- Consider caching search results for common queries
- Cache frequently used templates

### Parallel Execution
- Agent already runs tools in optimal order
- LangChain handles parallel tool calls when possible

### Timeout Configuration
```typescript
// In agent.service.ts
this.agentExecutor = new AgentExecutor({
  agent,
  tools,
  maxIterations: 10, // Lower for faster responses
  timeout: 30000, // 30 second timeout
});
```

## Monitoring

### Key Metrics
- Average generation time
- Success rate
- Most common query patterns
- Template usage vs from-scratch
- Tool call frequency

### Logging
Logs are automatically generated for:
- Agent invocations
- Tool calls and results
- Errors and failures
- Performance metrics

Check logs with:
```bash
# Development
npm run start:dev

# Production (with PM2 or similar)
pm2 logs llm-service
```

## Next Steps

1. **Phase 4**: Add streaming reasoning to UI
2. **Phase 5**: Implement design refinement ("add authentication")
3. **Phase 6**: Create specialized agents (security, cost analysis)
4. **Phase 7**: Add web search tool for architecture patterns

## Resources

- [AGENT_ARCHITECTURE.md](./AGENT_ARCHITECTURE.md) - Full architecture documentation
- [LangChain Docs](https://js.langchain.com/docs) - LangChain documentation
- [Ollama](https://ollama.ai/) - Local LLM documentation

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review agent logs for detailed error messages
3. Verify all services are running and accessible
4. Test individual tools independently
