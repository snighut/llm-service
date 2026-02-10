# Agent Architecture for Automated Design Generation

## Overview

This document describes the agentic AI architecture for automatically generating system designs based on natural language queries. The agent lives within the llm-service and orchestrates interactions with design-service to create visual system architecture diagrams.

## Architecture Decision

### Why Agent-Based Approach (Not MCP)

We chose to implement an **agentic LLM with tool calling** within llm-service rather than introducing Model Context Protocol (MCP) infrastructure for the following reasons:

1. **Existing Stack Support**: Our LangChain + Mistral stack already supports function/tool calling natively
2. **Reduced Complexity**: No additional server/protocol layer needed
3. **Focused Use Case**: We have a specific design generation workflow, not a general tool marketplace
4. **Easier Debugging**: Standard HTTP APIs and tool calling patterns
5. **Incremental Development**: Can build and test one tool at a time

**When to Consider MCP**: If we later need to expose design tools to external LLM clients (Claude Desktop, etc.) or build a marketplace of reusable design tools across multiple applications.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Collaboration App (Next.js)              │
│                                                             │
│  User: "Design a microservices e-commerce system"           │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  │ POST /agent/generate-design
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│                    LLM Service (NestJS)                      │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Agent Service                          │   │
│  │  - Receives natural language query                  │   │
│  │  - Orchestrates tool calling                        │   │
│  │  - Implements reasoning loop                        │   │
│  └────────────┬────────────────────────────────────────┘   │
│               │                                             │
│               │ Uses Tools:                                 │
│               │                                             │
│  ┌────────────▼──────────────────────────────────────┐     │
│  │  Tool 1: search_existing_designs                  │     │
│  │  Tool 2: get_design_by_id                         │     │
│  │  Tool 3: create_system_design                     │     │
│  │  Tool 4: google_search (optional)                 │     │
│  └────────────┬──────────────────────────────────────┘     │
└───────────────┼──────────────────────────────────────────────┘
                │
                │ HTTP Calls
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│                    Design Service (NestJS)                   │
│                                                             │
│  - GET  /designs?search=...                                 │
│  - GET  /designs/:id                                        │
│  - POST /designs (creates design + items + connections)     │
│  - PostgreSQL database                                      │
└─────────────────────────────────────────────────────────────┘
```

## Agent Workflow

### Step-by-Step Process

1. **User Query**: "Design a microservices architecture for an e-commerce platform"

2. **Agent Analysis**:
   ```typescript
   - Parse user intent
   - Extract key requirements (e-commerce, microservices, scalability)
   - Determine component types needed
   ```

3. **Search Existing Designs** (Tool 1):
   ```typescript
   searchExistingDesigns({ query: "microservices ecommerce" })
   // Returns: Array of similar designs with IDs
   ```

4. **Fetch Template** (Tool 2 - if found):
   ```typescript
   getDesignById({ designId: "uuid-123" })
   // Returns: Complete design with items and connections
   // Agent uses as reference for structure
   ```

5. **Generate Design Structure**:
   ```typescript
   // Agent reasons about:
   // - Required components (API Gateway, services, databases)
   // - Communication patterns (REST, message queues)
   // - Layout (positioning on canvas)
   ```

6. **Create Design** (Tool 3):
   ```typescript
   createSystemDesign({
     name: "E-commerce Microservices Architecture",
     description: "Generated based on user query...",
     items: [
       { name: "API Gateway", type: "service", x: 100, y: 100 },
       { name: "Product Service", type: "service", x: 300, y: 100 },
       { name: "Order Service", type: "service", x: 300, y: 300 },
       // ...
     ],
     connections: [
       { from: "API Gateway", to: "Product Service", name: "REST" },
       { from: "API Gateway", to: "Order Service", name: "REST" },
       // ...
     ]
   })
   ```

7. **Return Result**:
   ```typescript
   {
     designId: "newly-created-uuid",
     message: "Created e-commerce microservices architecture with 8 services"
   }
   ```

8. **Frontend Rendering**:
   - Collaboration-app fetches design by ID
   - Renders on React Konva canvas
   - User can edit/refine

## Implementation Phases

### Phase 1: Agent Module Structure

Create foundational module and services:

```
src/agent/
├── agent.module.ts           # NestJS module definition
├── agent.controller.ts       # HTTP endpoints
├── agent.service.ts          # Main agent orchestration
├── dto/
│   ├── generate-design.dto.ts
│   └── design-result.dto.ts
└── tools/
    ├── design-tools.service.ts  # Tools for design-service API
    └── search-tools.service.ts  # Tools for web search (optional)
```

### Phase 2: Tool Definitions

Define LangChain tools with schemas:

#### Tool 1: Search Existing Designs
```typescript
{
  name: "search_existing_designs",
  description: "Search for similar system designs in database to use as templates. Returns array of matching designs with IDs, names, and descriptions.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query (e.g., 'microservices', 'e-commerce', 'event-driven')"
      }
    },
    required: ["query"]
  }
}
```

#### Tool 2: Get Design Template
```typescript
{
  name: "get_design_by_id",
  description: "Fetch complete design including all items and connections. Use this to get template structure from similar designs.",
  parameters: {
    type: "object",
    properties: {
      designId: {
        type: "string",
        description: "UUID of the design to fetch"
      }
    },
    required: ["designId"]
  }
}
```

#### Tool 3: Create System Design
```typescript
{
  name: "create_system_design",
  description: "Create a new system architecture design with components and connections. This is the final step after planning.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Name of the system design"
      },
      description: {
        type: "string",
        description: "Detailed description of the architecture"
      },
      items: {
        type: "array",
        description: "Array of design components/items",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: "string", enum: ["service", "database", "queue", "cache", "gateway", "frontend", "backend"] },
            uidata: {
              type: "object",
              properties: {
                x: { type: "number" },
                y: { type: "number" }
              }
            },
            context: { type: "object" }
          },
          required: ["name", "type"]
        }
      },
      connections: {
        type: "array",
        description: "Array of connections between items",
        items: {
          type: "object",
          properties: {
            from: {
              type: "object",
              properties: {
                name: { type: "string" },
                type: { type: "string", enum: ["DesignItem", "DesignGroup"] }
              }
            },
            to: {
              type: "object",
              properties: {
                name: { type: "string" },
                type: { type: "string", enum: ["DesignItem", "DesignGroup"] }
              }
            },
            name: { type: "string", description: "Connection label (e.g., 'REST API', 'Message Queue')" },
            context: { type: "object" }
          },
          required: ["from", "to"]
        }
      }
    },
    required: ["name", "items"]
  }
}
```

### Phase 3: Agent Implementation

**Key Components**:

1. **Agent Service** (`agent.service.ts`):
   - Uses LangChain's `createToolCallingAgent` or `createReactAgent`
   - Configures Mistral model with tool definitions
   - Implements reasoning loop

2. **Design Tools Service** (`design-tools.service.ts`):
   - HTTP client for design-service APIs
   - Implements tool functions
   - Handles error cases

3. **Agent Controller** (`agent.controller.ts`):
   - Exposes `/agent/generate-design` endpoint
   - Validates input
   - Returns design ID + metadata

**Agent Reasoning Flow**:

```typescript
// Pseudo-code
async function generateDesign(query: string) {
  // LLM with tools reasons:
  
  // Step 1: Should I search for similar designs?
  const similarDesigns = await searchExistingDesigns({
    query: extractKeywords(query)
  });
  
  // Step 2: If found, get template structure
  let template = null;
  if (similarDesigns.length > 0) {
    template = await getDesignById({ 
      designId: similarDesigns[0].id 
    });
  }
  
  // Step 3: Generate design structure
  const designSpec = generateDesignSpec({
    query,
    template,
    bestPractices: await searchWeb(query) // optional
  });
  
  // Step 4: Create the design
  const result = await createSystemDesign(designSpec);
  
  return { designId: result.id, message: "Created!" };
}
```

## Configuration

### Environment Variables

Add to `llm-service/.env`:

```bash
# Design Service API
DESIGN_SERVICE_URL=http://design-service:3000
DESIGN_SERVICE_API_KEY=your-api-key-here

# Agent Configuration
AGENT_MAX_ITERATIONS=10
AGENT_TIMEOUT_MS=60000
AGENT_ENABLE_WEB_SEARCH=false

# Existing Ollama config (already present)
OLLAMA_HOST=http://your-ollama-server:11434
```

### Dependencies

Already installed:
- `@langchain/ollama` ✅
- `@langchain/core` ✅
- `@langchain/community` ✅

Need to add:
- `@langchain/experimental` (for advanced agents)
- Or use LangGraph for more complex flows

## API Specification

### Generate Design Endpoint

**Request**:
```http
POST /agent/generate-design
Content-Type: application/json

{
  "query": "Design a microservices architecture for an e-commerce platform with payment processing",
  "options": {
    "useTemplates": true,
    "enableWebSearch": false,
    "maxComponents": 20
  }
}
```

**Response**:
```json
{
  "designId": "uuid-of-created-design",
  "name": "E-commerce Microservices Architecture",
  "message": "Created architecture with 8 services and 12 connections",
  "reasoning": [
    "Searched for similar microservices designs",
    "Found template: 'Generic Microservices Pattern'",
    "Adapted for e-commerce domain",
    "Added payment gateway integration",
    "Created design with API Gateway, Product Service, Order Service..."
  ],
  "metadata": {
    "componentsCount": 8,
    "connectionsCount": 12,
    "processingTimeMs": 3421
  }
}
```

**Error Response**:
```json
{
  "error": "Design generation failed",
  "details": "Unable to connect to design-service",
  "statusCode": 503
}
```

## Design Patterns & Best Practices

### 1. Component Type Mapping

```typescript
const COMPONENT_TYPE_MAPPING = {
  // User intent → Design item type
  'api': 'gateway',
  'gateway': 'gateway',
  'service': 'service',
  'microservice': 'service',
  'database': 'database',
  'db': 'database',
  'cache': 'cache',
  'redis': 'cache',
  'queue': 'queue',
  'kafka': 'queue',
  'rabbitmq': 'queue',
  'frontend': 'frontend',
  'backend': 'backend'
};
```

### 2. Layout Generation

Use automatic positioning algorithm:
```typescript
function generateLayout(items: Item[]) {
  const SPACING_X = 250;
  const SPACING_Y = 200;
  const START_X = 100;
  const START_Y = 100;
  
  // Layer-based layout (gateway → services → databases)
  const layers = categorizeByLayer(items);
  
  return items.map((item, index) => ({
    ...item,
    uidata: {
      x: START_X + (layer * SPACING_X),
      y: START_Y + (indexInLayer * SPACING_Y)
    }
  }));
}
```

### 3. Connection Intelligence

```typescript
// Infer connection types based on component types
function inferConnectionType(from: Item, to: Item): string {
  if (from.type === 'gateway' && to.type === 'service') return 'REST API';
  if (from.type === 'service' && to.type === 'database') return 'SQL';
  if (from.type === 'service' && to.type === 'queue') return 'Pub/Sub';
  if (from.type === 'service' && to.type === 'cache') return 'Cache';
  return 'Connection';
}
```

## Testing Strategy

### Unit Tests
- Test each tool function independently
- Mock design-service HTTP calls
- Verify tool schema validation

### Integration Tests
- Test agent reasoning with simple queries
- Verify design creation end-to-end
- Test error handling

### Example Test Cases
1. "Design a simple API with database" → Should create 2 items + 1 connection
2. "Design microservices for e-commerce" → Should search templates first
3. Invalid query → Should ask for clarification
4. Design-service unavailable → Should return helpful error

## Future Enhancements

### Phase 4: Advanced Features
- **Streaming reasoning**: Stream agent thoughts to UI in real-time
- **Design refinement**: "Add authentication service" modifies existing design
- **Best practices validation**: Agent checks for anti-patterns
- **Cost estimation**: Estimate cloud costs for the architecture

### Phase 5: Learning & Improvement
- **Feedback loop**: Learn from user edits after generation
- **Design library**: Curate best designs as templates
- **Style transfer**: "Make it look like design X"

### Phase 6: Multi-Agent System
- **Specialist agents**: Security agent, scalability agent, cost agent
- **Consensus mechanism**: Multiple agents vote on best design
- **Explanation agent**: Generates detailed documentation

## Monitoring & Observability

### Metrics to Track
- Design generation success rate
- Average processing time
- Tool usage frequency
- Template usage vs. from-scratch
- User refinement rate (how much they edit after generation)

### Logging
```typescript
logger.log({
  event: 'design_generation_started',
  query: sanitize(query),
  timestamp: new Date()
});

logger.log({
  event: 'tool_called',
  toolName: 'search_existing_designs',
  parameters: { query: '...' },
  result: { count: 3 }
});

logger.log({
  event: 'design_created',
  designId: 'uuid',
  componentsCount: 8,
  processingTime: 3421
});
```

## Security Considerations

1. **Rate Limiting**: Limit design generations per user/hour
2. **Input Validation**: Sanitize queries to prevent injection
3. **API Authentication**: Secure design-service communication
4. **Resource Limits**: Max components, connections per design
5. **Audit Trail**: Log all design generations with user context

## Conclusion

This agentic architecture enables natural language-based system design generation while leveraging existing infrastructure. The phased approach allows for incremental development and testing, with clear paths for future enhancement.

**Next Steps**: Implement Phase 1-3 in llm-service, starting with the agent module structure.
