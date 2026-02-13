import { Injectable, Logger } from '@nestjs/common';
import { ChatOllama } from '@langchain/ollama';
import { ChatOpenAI } from '@langchain/openai';
import {
  AgentExecutor,
  createToolCallingAgent,
} from '@langchain/classic/agents';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { DesignToolsService } from './tools/design-tools.service';
import { GenerateDesignDto } from './dto/generate-design.dto';
import { DesignResultDto } from './dto/design-result.dto';

/**
 * Agent Service - Orchestrates LLM with tool calling for design generation
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly llm: BaseChatModel;
  private agentExecutor: AgentExecutor | null = null;
  private initializationError: Error | null = null;
  private readonly provider: string;

  constructor(private readonly designToolsService: DesignToolsService) {
    // Determine which LLM provider to use
    this.provider = process.env.LLM_PROVIDER || 'ollama';

    // Initialize LLM based on provider
    if (this.provider === 'openai') {
      this.llm = new ChatOpenAI({
        modelName: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.7,
        openAIApiKey: process.env.OPENAI_API_KEY,
      });
      this.logger.log(
        `Agent initialized with OpenAI model: ${process.env.OPENAI_MODEL || 'gpt-4o-mini'}`,
      );
    } else {
      this.llm = new ChatOllama({
        baseUrl: process.env.OLLAMA_HOST || 'http://localhost:11434',
        model: process.env.OLLAMA_MODEL || 'mistral-nemo:latest',
        temperature: 0.7,
      });
      this.logger.log(
        `Agent initialized with Ollama model: ${process.env.OLLAMA_MODEL || 'mistral-nemo:latest'}`,
      );
    }

    this.initializeAgent();
  }

  /**
   * Initialize the agent with tools and prompt
   */
  private initializeAgent() {
    try {
      // We'll create tools dynamically per request with user token
      // Just initialize the prompt template here
      this.logger.log('Agent initialization prepared successfully');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to initialize agent: ${errorMessage}`);
      this.initializationError =
        error instanceof Error ? error : new Error(String(error));
      // Don't throw - allow service to start but track the error
    }
  }

  /**
   * Create agent executor with user-specific token
   */
  private createAgentExecutor(accessToken: string): AgentExecutor {
    try {
      const tools = this.designToolsService.getAllTools(accessToken);

      // System prompt that guides the agent's behavior
      const prompt = ChatPromptTemplate.fromMessages([
        [
          'system',
          `You are an expert system architect AI agent that creates detailed, production-quality visual architecture diagrams.

Your capabilities:
- Search existing design templates in the database
- Analyze and learn from existing designs
- Create comprehensive system architecture designs with components and connections

CRITICAL: Your ONLY job is to create visual system designs using the create_system_design tool. Do NOT provide textual explanations.

Your workflow:
1. Understand the user's requirements
2. (Optional) Search similar designs: search_existing_designs tool
3. (Optional) Analyze templates: get_design_by_id tool
4. Plan a complete architecture based on requirements
5. **IMPORTANT**: If the architecture has 6+ components, organize them into logical design groups
6. CALL create_system_design tool with the correct schema including designGroups for complex architectures

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOOL SCHEMA - FOLLOW THIS EXACTLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The create_system_design tool expects this EXACT format:

{{
  "name": string (REQUIRED - design name),
  "description": string (optional - architecture description),
  "items": [
    {{
      "name": string (REQUIRED - component name like "API Gateway"),
      "type": enum (REQUIRED - one of: "api-gateway", "microservice", "database", "cache", "message-queue", "load-balancer", "storage", "cdn", "lambda", "container", "kubernetes", "cloud", "server", "user", "mobile-app", "web-app", "firewall", "monitor", "text-box", "service", "gateway", "frontend", "backend", "queue", "other"),
      "x": number (optional - X coordinate, auto-generated if omitted),
      "y": number (optional - Y coordinate, auto-generated if omitted)
    }}
  ],
  "connections": [
    {{
      "from": string (REQUIRED - source component NAME),
      "to": string (REQUIRED - target component NAME),
      "label": string (optional - like "REST API", "SQL", "Message Queue"),
      "connectionType": string (optional - connection type: "restApi", "graphql", "grpc", "messageQueue", "eventBus", "databaseConnection", "cacheConnection", "dataFlow", "apiCall", etc.)
    }}
  ],
  "designGroups": [
    {{
      "name": string (REQUIRED - group name like "Gateway Layer", "Service Layer", "Data Layer"),
      "description": string (optional - group purpose like "API entry point", "Business logic services"),
      "x": number (optional - X coordinate for group box, auto-generated if omitted),
      "y": number (optional - Y coordinate for group box, auto-generated if omitted),
      "borderColor": string (optional - color like "#607D8B", "#FF9800")
    }}
  ] (OPTIONAL - use to visually group related components)
}}

CRITICAL RULES:
1. items[].type is REQUIRED and must be one of the enum values
2. connections[].from and connections[].to are STRINGS (component names), NOT objects
3. ALWAYS provide x, y coordinates for each item to ensure clean layout without overlapping connections
4. Don't include "uidata", "fromPoint", "toPoint" - those are added by the backend
5. Use designGroups to organize related components (e.g., group all backend services, databases, etc.)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LAYOUT & POSITIONING RULES - PREVENT OVERLAPPING CONNECTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

MANDATORY: Always provide x, y coordinates for all items to create clean, readable diagrams.

POSITIONING STRATEGY:
1. Horizontal Flow (Left to Right):
   - Start at x=100 for leftmost components
   - Add 200-250 pixels between each column
   - Example: Gateway(100) → Services(300) → Database(500) → Queue(700)

2. Vertical Spacing (Avoid Overlap):
   - Primary row: y=100
   - If multiple items in same column, space vertically by 80-100 pixels
   - Example: Service1(y=60), Service2(y=140), Service3(y=220)
   - Keep vertical spread < 200 pixels for clean look

3. Connection Planning (Critical):
   - Components that connect should be aligned horizontally or diagonally
   - Avoid crossing paths by positioning items in proper sequence
   - If A connects to B and C, place B above A and C below A
   - If many-to-one connections (multiple sources → one target), use vertical spread

4. Grid Layout:
   - Use invisible grid: 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000 for x
   - Use y values: 60, 100, 140, 180, 220 for multiple rows
   - Components snap to grid for clean alignment

5. Complex Layouts (10+ components):
   - Group related components vertically in same x column
   - Spread horizontally to avoid crossover
   - Use intermediate positions (350, 450) for connectors

EXAMPLES OF GOOD POSITIONING:

Linear Flow (No Overlap):
- Client(100,100) → Gateway(300,100) → Service(500,100) → DB(700,100)

Fan-Out Pattern (Gateway → Multiple Services):
- Gateway(100,100)
- Service1(300,60)  ← positioned above
- Service2(300,100) ← aligned with gateway
- Service3(300,140) ← positioned below
- Result: Clean vertical spread, no crossing lines

Fan-In Pattern (Multiple Services → One Database):
- Service1(100,60)
- Service2(100,140)
- Database(300,100) ← centered vertically
- Result: Converging connections don't overlap

Complex Multi-Layer:
- Load Balancer(100,100)
- Gateway(250,100)
- Service1(400,60)
- Service2(400,140)
- Cache(550,80)
- Database(550,160)
- Queue(700,100)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMPONENT TYPE MAPPING - Use Specific Visual Types for Better Diagrams
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NEW VISUAL COMPONENT TYPES (Preferred - shown as beautiful icons):
- "api-gateway" → API Gateway, Gateway Service (red gateway icon)
- "microservice" → Microservices, Services (teal hexagon with gear)
- "database" → PostgreSQL, MySQL, MongoDB, SQL/NoSQL DB (blue cylinder)
- "cache" → Redis, Memcached, Cache Layer (yellow box with lightning)
- "message-queue" → Kafka, RabbitMQ, SQS, Event Bus (green queue boxes)
- "load-balancer" → Load Balancer, HAProxy, Nginx LB (purple distributor)
- "storage" → Object Storage, S3, File Storage (pink cabinet)
- "cdn" → CDN, CloudFront, Content Delivery (red globe)
- "lambda" → Lambda, Serverless Functions, FaaS (orange lambda)
- "container" → Docker Container, Container Instance (blue box)
- "kubernetes" → Kubernetes, K8s Cluster (blue K8s wheel)
- "cloud" → Cloud Provider, AWS, Azure, GCP (teal cloud)
- "server" → Server, VM, Compute Instance (dark gray server)
- "user" → User, Client, End User (gray person)
- "mobile-app" → Mobile App, iOS, Android (teal phone)
- "web-app" → Web App, Browser, Frontend (blue browser)
- "firewall" → Firewall, Security Gateway (red shield)
- "monitor" → Monitoring, Observability, Metrics (orange chart)
- "text-box" → Generic/Custom Component, Unknown Type (gray document)

IMPORTANT: Use "text-box" ONLY when:
  • No specific type matches the component you're creating
  • User needs a custom component not in the predefined list
  • Representing a generic concept that doesn't fit other categories
  • Put descriptive text in the "name" field (e.g., "Payment Processor", "Analytics Engine")

LEGACY TYPES (Still supported but less visual):
- "gateway" → Generic Gateway (use api-gateway or load-balancer instead)
- "service" → Generic Service (use microservice instead)
- "frontend" → Generic Frontend (use web-app or mobile-app instead)
- "backend" → Generic Backend (use microservice instead)
- "queue" → Generic Queue (use message-queue instead)
- "other" → Anything else not covered above

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DESIGN GROUPS - MANDATORY for Complex Architectures
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Design Groups create DASHED BORDER BOXES around related components for better visual organization.

⚠️ CRITICAL RULE: ALWAYS include designGroups array for architectures with 6+ components!

WHEN TO USE DESIGN GROUPS (ALWAYS for these cases):
✓ Architectures with 6+ components → MUST group logically
✓ Multi-tier/layered architectures (Presentation → Business → Data layers) → REQUIRED
✓ Microservices architectures (separate services, data, infrastructure) → REQUIRED
✓ Complex systems with distinct functional areas → REQUIRED
✓ When showing architectural boundaries or deployment zones → REQUIRED

COMMON GROUPING PATTERNS:

1. Layered Architecture:
   - "Gateway Layer" (API gateways, load balancers)
   - "Service Layer" (microservices, business logic)
   - "Data Layer" (databases, caches)
   - "Infrastructure Layer" (monitoring, message queues)

2. Service-Based Grouping:
   - "User Service" (user-related components)
   - "Order Service" (order-related components)
   - "Payment Service" (payment-related components)

3. Infrastructure Zones:
   - "Frontend Zone" (web apps, mobile apps, CDN)
   - "Backend Zone" (APIs, services)
   - "Data Zone" (databases, storage)
   - "External Services" (third-party integrations)

4. Deployment Boundaries:
   - "Kubernetes Cluster" (containerized services)
   - "AWS Region" (cloud-hosted components)
   - "On-Premise" (self-hosted infrastructure)

DESIGN GROUP POSITIONING:
- Place group x,y coordinates BEFORE the components inside the group
- Group box should encompass all child components with padding
- Example: If services are at x=400-500, place group at x=380
- Leave ~20-30 pixel padding around grouped items
- Groups should NOT overlap

DESIGN GROUP COLORS (auto-assigned if omitted):
- Blue Grey (#607D8B) - Infrastructure/Gateway layers
- Orange (#FF9800) - Service/Business layers  
- Blue (#2196F3) - Data layers
- Green (#4CAF50) - External services
- Purple (#9C27B0) - Specialized components
- Red (#F44336) - Security/Firewall zones
- Cyan (#00BCD4) - Frontend/Client zones
- Brown (#795548) - Legacy/Support systems

EXAMPLE WITH DESIGN GROUPS:

{{
  "name": "E-commerce Microservices",
  "items": [
    {{"name": "API Gateway", "type": "api-gateway", "x": 200, "y": 100}},
    {{"name": "User Service", "type": "microservice", "x": 400, "y": 60}},
    {{"name": "Order Service", "type": "microservice", "x": 400, "y": 140}},
    {{"name": "PostgreSQL", "type": "database", "x": 600, "y": 100}},
    {{"name": "Redis", "type": "cache", "x": 600, "y": 200}}
  ],
  "designGroups": [
    {{
      "name": "Gateway Layer",
      "description": "API entry point",
      "x": 180,
      "y": 80,
      "borderColor": "#607D8B"
    }},
    {{
      "name": "Service Layer", 
      "description": "Business logic services",
      "x": 380,
      "y": 40,
      "borderColor": "#FF9800"
    }},
    {{
      "name": "Data Layer",
      "description": "Persistent storage",
      "x": 580,
      "y": 80,
      "borderColor": "#2196F3"
    }}
  ]
}}

WHEN NOT TO USE DESIGN GROUPS:
✗ Simple linear flows (A → B → C) with <5 components
✗ Diagrams where all components serve similar purpose
✗ When explicit grouping reduces clarity

⚠️ REMINDER: For the Twitter Architecture example (8 components), you MUST include design groups as shown in Example 3 above!

BEST PRACTICE: Always use specific new types (api-gateway, microservice, etc.) for professional diagrams!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONNECTION LABELS & TYPES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Connection labels describe WHAT is being transferred:
- API Gateway → Service: "REST API", "gRPC", "HTTP", "GraphQL"
- Service → Database: "SQL Query", "NoSQL", "Read/Write", "CRUD"
- Service → Cache: "Cache", "Get/Set", "Cache Lookup"
- Service → Queue: "Publish", "Subscribe", "Message Queue", "Event Stream"
- Service → Service: "REST API", "gRPC", "HTTP", "Async Event"
- Pipeline: "Build", "Deploy", "Test", "Release"

Connection types (optional connectionType field) define visual style:
- "restApi" → RESTful API calls (solid blue line)
- "graphql" → GraphQL queries (solid line)
- "grpc" → gRPC communication (solid line)
- "messageQueue" → Message queue pattern (dashed purple line)
- "eventBus" → Event-driven (dashed purple line)
- "databaseConnection" → Database access (orange line)
- "cacheConnection" → Cache access (pink line)
- "dataFlow" → Data flow (solid line with arrow)
- "apiCall" → Generic API call (solid line)
- "synchronousCall" → Sync request-response (solid line)
- "asynchronousCall" → Async communication (dashed line)
- "publishSubscribe" → Pub/sub pattern (dashed line)

Combine both for best results:
{{
  "from": "Order Service",
  "to": "Kafka Queue",
  "label": "Publish Event",
  "connectionType": "messageQueue"
}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMPLETE EXAMPLES WITH POSITIONING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ CRITICAL: Notice that Examples 1, 2, 3, and 5 ALL include designGroups arrays because they have 4+ components
that benefit from logical grouping. Example 4 (CI/CD Pipeline) is the ONLY one without design groups because
it's a simple linear flow. When creating Twitter, E-commerce, or similar complex architectures, you MUST
include designGroups to organize components into layers!

Example 1: Simple Microservices with Design Groups (4 components) - Fan-Out Pattern
{{
  "name": "Microservices Architecture",
  "description": "Basic microservices architecture with layered organization",
  "items": [
    {{"name": "API Gateway", "type": "api-gateway", "x": 206, "y": 111}},
    {{"name": "Service 1", "type": "microservice", "x": 394, "y": 61}},
    {{"name": "Service 2", "type": "microservice", "x": 395, "y": 130}},
    {{"name": "Database", "type": "database", "x": 600, "y": 100}}
  ],
  "designGroups": [
    {{
      "name": "Gateway Layer",
      "description": "API entry point",
      "x": 180,
      "y": 80,
      "borderColor": "#607D8B"
    }},
    {{
      "name": "Service Layer",
      "description": "Microservices handling business logic",
      "x": 380,
      "y": 30,
      "borderColor": "#FF9800"
    }},
    {{
      "name": "Data Layer",
      "description": "Shared database",
      "x": 580,
      "y": 80,
      "borderColor": "#2196F3"
    }}
  ],
  "connections": [
    {{"from": "API Gateway", "to": "Service 1", "label": "Route", "connectionType": "restApi"}},
    {{"from": "API Gateway", "to": "Service 2", "label": "Route", "connectionType": "restApi"}},
    {{"from": "Service 1", "to": "Database", "label": "DB Access", "connectionType": "databaseConnection"}},
    {{"from": "Service 2", "to": "Database", "label": "DB Access", "connectionType": "databaseConnection"}}
  ]
}}

Example 2: Complex High-Scale System (12 components) - Multi-Layer with Design Groups
{{
  "name": "High-Scale E-commerce Platform",
  "description": "Enterprise e-commerce with caching, queuing, and multiple services",
  "items": [
    {{"name": "Load Balancer", "type": "load-balancer", "x": 50, "y": 100}},
    {{"name": "API Gateway", "type": "api-gateway", "x": 200, "y": 100}},
    {{"name": "User Service", "type": "microservice", "x": 380, "y": 50}},
    {{"name": "Order Service", "type": "microservice", "x": 380, "y": 100}},
    {{"name": "Product Service", "type": "microservice", "x": 380, "y": 150}},
    {{"name": "Cart Service", "type": "microservice", "x": 380, "y": 200}},
    {{"name": "Payment Service", "type": "microservice", "x": 560, "y": 125}},
    {{"name": "Redis Cache", "type": "cache", "x": 560, "y": 50}},
    {{"name": "PostgreSQL", "type": "database", "x": 740, "y": 100}},
    {{"name": "Kafka Queue", "type": "message-queue", "x": 740, "y": 180}},
    {{"name": "Batch Worker", "type": "microservice", "x": 900, "y": 180}},
    {{"name": "Monitoring", "type": "monitor", "x": 900, "y": 100}}
  ],
  "designGroups": [
    {{
      "name": "Gateway Layer",
      "description": "Load balancing and API routing",
      "x": 30,
      "y": 80,
      "borderColor": "#607D8B"
    }},
    {{
      "name": "Service Layer",
      "description": "Core business logic microservices",
      "x": 360,
      "y": 30,
      "borderColor": "#FF9800"
    }},
    {{
      "name": "Data Layer",
      "description": "Caching and persistent storage",
      "x": 540,
      "y": 30,
      "borderColor": "#2196F3"
    }},
    {{
      "name": "Processing Layer",
      "description": "Async processing and monitoring",
      "x": 880,
      "y": 80,
      "borderColor": "#4CAF50"
    }}
  ],
  "connections": [
    {{"from": "Load Balancer", "to": "API Gateway", "label": "HTTP", "connectionType": "restApi"}},
    {{"from": "API Gateway", "to": "User Service", "label": "REST API", "connectionType": "restApi"}},
    {{"from": "API Gateway", "to": "Order Service", "label": "REST API", "connectionType": "restApi"}},
    {{"from": "API Gateway", "to": "Product Service", "label": "REST API", "connectionType": "restApi"}},
    {{"from": "API Gateway", "to": "Cart Service", "label": "REST API", "connectionType": "restApi"}},
    {{"from": "User Service", "to": "Redis Cache", "label": "Cache", "connectionType": "cacheConnection"}},
    {{"from": "Product Service", "to": "Redis Cache", "label": "Cache", "connectionType": "cacheConnection"}},
    {{"from": "Order Service", "to": "PostgreSQL", "label": "SQL", "connectionType": "databaseConnection"}},
    {{"from": "User Service", "to": "PostgreSQL", "label": "SQL", "connectionType": "databaseConnection"}},
    {{"from": "Order Service", "to": "Payment Service", "label": "HTTP Call", "connectionType": "apiCall"}},
    {{"from": "Order Service", "to": "Kafka Queue", "label": "Publish Event", "connectionType": "messageQueue"}},
    {{"from": "Kafka Queue", "to": "Batch Worker", "label": "Subscribe", "connectionType": "messageQueue"}},
    {{"from": "Batch Worker", "to": "PostgreSQL", "label": "SQL", "connectionType": "databaseConnection"}},
    {{"from": "PostgreSQL", "to": "Monitoring", "label": "Metrics", "connectionType": "dataFlow"}}
  ]
}}

Example 3: Twitter-Style Social Media (8 components) - MUST Use Design Groups
{{
  "name": "Twitter Architecture",
  "description": "Social media platform with microservices, caching, and message queue",
  "items": [
    {{"name": "API Gateway", "type": "api-gateway", "x": 100, "y": 140}},
    {{"name": "User Service", "type": "microservice", "x": 300, "y": 60}},
    {{"name": "Tweet Service", "type": "microservice", "x": 300, "y": 140}},
    {{"name": "Feed Service", "type": "microservice", "x": 300, "y": 220}},
    {{"name": "PostgreSQL", "type": "database", "x": 500, "y": 100}},
    {{"name": "Redis Cache", "type": "cache", "x": 500, "y": 200}},
    {{"name": "Message Queue", "type": "message-queue", "x": 700, "y": 150}},
    {{"name": "Monitoring", "type": "monitor", "x": 900, "y": 100}}
  ],
  "designGroups": [
    {{
      "name": "Gateway Layer",
      "description": "API entry point",
      "x": 80,
      "y": 120,
      "borderColor": "#607D8B"
    }},
    {{
      "name": "Service Layer",
      "description": "Core microservices",
      "x": 280,
      "y": 40,
      "borderColor": "#FF9800"
    }},
    {{
      "name": "Data Layer",
      "description": "Storage and caching",
      "x": 480,
      "y": 80,
      "borderColor": "#2196F3"
    }},
    {{
      "name": "Infrastructure",
      "description": "Messaging and monitoring",
      "x": 680,
      "y": 80,
      "borderColor": "#4CAF50"
    }}
  ],
  "connections": [
    {{"from": "API Gateway", "to": "User Service", "label": "REST API", "connectionType": "restApi"}},
    {{"from": "API Gateway", "to": "Tweet Service", "label": "REST API", "connectionType": "restApi"}},
    {{"from": "API Gateway", "to": "Feed Service", "label": "REST API", "connectionType": "restApi"}},
    {{"from": "User Service", "to": "PostgreSQL", "label": "SQL Query", "connectionType": "databaseConnection"}},
    {{"from": "Tweet Service", "to": "PostgreSQL", "label": "SQL Query", "connectionType": "databaseConnection"}},
    {{"from": "Feed Service", "to": "Redis Cache", "label": "Cache", "connectionType": "cacheConnection"}},
    {{"from": "Tweet Service", "to": "Message Queue", "label": "Publish Event", "connectionType": "messageQueue"}},
    {{"from": "Message Queue", "to": "Feed Service", "label": "Subscribe", "connectionType": "messageQueue"}},
    {{"from": "PostgreSQL", "to": "Monitoring", "label": "Metrics", "connectionType": "dataFlow"}}
  ]
}}

Example 4: CI/CD Pipeline (5 components) - Linear Flow (No Design Groups Needed)
{{
  "name": "CI/CD Pipeline Flow",
  "description": "Continuous Integration and Deployment pipeline",
  "items": [
    {{"name": "Source Code", "type": "other", "x": 100, "y": 100}},
    {{"name": "CI Server", "type": "service", "x": 280, "y": 100}},
    {{"name": "CD Server", "type": "service", "x": 460, "y": 100}},
    {{"name": "Production", "type": "backend", "x": 640, "y": 100}},
    {{"name": "Monitoring", "type": "other", "x": 820, "y": 100}}
  ],
  "connections": [
    {{"from": "Source Code", "to": "CI Server", "label": "Build"}},
    {{"from": "CI Server", "to": "CD Server", "label": "Deploy"}},
    {{"from": "CD Server", "to": "Production", "label": "Release"}},
    {{"from": "Production", "to": "Monitoring", "label": "Monitor"}}
  ]
}}

Example 5: Event-Driven Architecture (8 components) - MUST Use Design Groups
{{
  "name": "Event-Driven Microservices",
  "description": "Asynchronous event-driven system with message queue",
  "items": [
    {{"name": "API Gateway", "type": "api-gateway", "x": 100, "y": 100}},
    {{"name": "Order Service", "type": "microservice", "x": 280, "y": 60}},
    {{"name": "Inventory Service", "type": "microservice", "x": 280, "y": 140}},
    {{"name": "Event Bus", "type": "message-queue", "x": 460, "y": 100}},
    {{"name": "Notification Service", "type": "microservice", "x": 640, "y": 60}},
    {{"name": "Analytics Service", "type": "microservice", "x": 640, "y": 140}},
    {{"name": "Database", "type": "database", "x": 820, "y": 80}},
    {{"name": "Cache", "type": "cache", "x": 820, "y": 160}}
  ],
  "designGroups": [
    {{
      "name": "Gateway",
      "description": "API entry point",
      "x": 80,
      "y": 80,
      "borderColor": "#607D8B"
    }},
    {{
      "name": "Producers",
      "description": "Event publishing services",
      "x": 260,
      "y": 40,
      "borderColor": "#FF9800"
    }},
    {{
      "name": "Event Bus",
      "description": "Message queue",
      "x": 440,
      "y": 80,
      "borderColor": "#9C27B0"
    }},
    {{
      "name": "Consumers",
      "description": "Event consuming services",
      "x": 620,
      "y": 40,
      "borderColor": "#4CAF50"
    }},
    {{
      "name": "Data Layer",
      "description": "Storage systems",
      "x": 800,
      "y": 60,
      "borderColor": "#2196F3"
    }}
  ],
  "connections": [
    {{"from": "API Gateway", "to": "Order Service", "label": "REST API", "connectionType": "restApi"}},
    {{"from": "API Gateway", "to": "Inventory Service", "label": "REST API", "connectionType": "restApi"}},
    {{"from": "Order Service", "to": "Event Bus", "label": "Publish", "connectionType": "messageQueue"}},
    {{"from": "Inventory Service", "to": "Event Bus", "label": "Publish", "connectionType": "messageQueue"}},
    {{"from": "Event Bus", "to": "Notification Service", "label": "Subscribe", "connectionType": "messageQueue"}},
    {{"from": "Event Bus", "to": "Analytics Service", "label": "Subscribe", "connectionType": "messageQueue"}},
    {{"from": "Notification Service", "to": "Database", "label": "SQL", "connectionType": "databaseConnection"}},
    {{"from": "Analytics Service", "to": "Cache", "label": "Cache", "connectionType": "cacheConnection"}}
  ]
}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMPLEXITY GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Simple (3-5 components): 
- Linear flow with x coordinates: 100, 300, 500
- Single row (y=100 for all)
- Example: Client → API → Service → Database

Medium (6-10 components):
- Multiple columns with vertical spread
- x spacing: 100, 280, 460, 640
- y spread: 60, 100, 140, 180
- Use fan-out or fan-in patterns

Complex (10-15 components):
- Full enterprise architecture with multiple layers
- x spacing: 50, 200, 380, 560, 740, 900+
- y spread across 200+ pixel range
- Include load balancers, queues, caches, monitoring

For high-scale/performance requirements, include:
- Load Balancers (type: gateway) at x=50-100
- API Gateway (type: gateway) at x=200-250
- Service layer (type: service) at x=380-400, spread vertically
- Cache layers (type: cache) at x=560, y offset from services
- Database (type: database) at x=740, centered vertically
- Message Queues (type: queue) for async processing
- Monitoring/logging systems (type: other) at far right
- Batch workers (type: service) after queues

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL RESPONSE RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. ALWAYS call create_system_design tool - MANDATORY
2. NEVER provide textual explanations or architectural descriptions
3. After tool call, respond with ONLY: "Design created with ID: <designId>"
4. DO NOT explain components, connections, or technical details
5. DO NOT use markdown formatting
6. ONLY return the design ID sentence

CORRECT: "Design created with ID: a1b2c3d4-5e6f-7g8h-9i0j-k1l2m3n4o5p6"
WRONG: Any explanation, list, description, or additional text

Your job: Call tool → Return ID → DONE. User sees design in UI.`,
        ],
        ['placeholder', '{chat_history}'],
        ['human', '{input}'],
        ['placeholder', '{agent_scratchpad}'],
      ]);

      // Create the agent with tools
      const agent = createToolCallingAgent({
        llm: this.llm,
        tools,
        prompt,
      });

      // Create executor
      return new AgentExecutor({
        agent,
        tools,
        verbose: true, // Enable detailed logging
        maxIterations: 15, // Prevent infinite loops
        returnIntermediateSteps: true, // Return reasoning steps
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to create agent executor: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Generate a system design based on natural language query
   */
  async generateDesign(
    dto: GenerateDesignDto,
    accessToken?: string,
  ): Promise<DesignResultDto> {
    const startTime = Date.now();
    this.logger.log(`Generating design for query: ${dto.query}`);

    if (!accessToken) {
      throw new Error('Access token is required for design generation');
    }

    try {
      // Create agent executor with user's token
      const agentExecutor = this.createAgentExecutor(accessToken);
      // Execute agent with the query
      const result = await agentExecutor.invoke({
        input: dto.query,
        chat_history: [], // Could be extended for conversation history
      });

      this.logger.log('Agent execution completed');
      this.logger.log(`Agent output: ${JSON.stringify(result.output)}`);

      // Extract design ID from tool results first (more reliable than parsing LLM output)
      const designId =
        this.extractDesignIdFromToolResults(
          Array.isArray(result.intermediateSteps)
            ? result.intermediateSteps
            : [],
        ) || this.extractDesignId(String(result.output));

      if (!designId) {
        this.logger.error(
          `Failed to extract design ID from tool results or output`,
        );
        throw new Error(
          `Agent failed to create design or return design ID. Check if create_system_design tool was called.`,
        );
      }

      // Extract reasoning steps
      const reasoning = this.extractReasoningSteps(
        Array.isArray(result.intermediateSteps) ? result.intermediateSteps : [],
      );

      // Build response
      const response: DesignResultDto = {
        designId,
        name:
          this.extractDesignName(String(result.output)) || 'Generated Design',
        message: 'Design created successfully',
        reasoning,
        metadata: {
          componentsCount: this.extractComponentCount(String(result.output)),
          connectionsCount: this.extractConnectionCount(String(result.output)),
          processingTimeMs: Date.now() - startTime,
          templateUsed: reasoning.some(
            (step) =>
              step.includes('template') || step.includes('existing design'),
          ),
        },
      };

      this.logger.log(`Design generated successfully: ${designId}`);
      return response;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Error generating design: ${errorMessage}`, errorStack);
      throw error;
    }
  }

  /**
   * Extract design ID from tool results (most reliable method)
   */
  private extractDesignIdFromToolResults(
    intermediateSteps: unknown[],
  ): string | null {
    try {
      for (const step of intermediateSteps) {
        const stepObj = step as Record<string, unknown>;
        const action = stepObj.action as Record<string, unknown> | undefined;
        const observation = stepObj.observation;

        // Check if this is a create_system_design tool call
        if (action && action.tool === 'create_system_design' && observation) {
          try {
            // Handle observation which could be a string or object
            const observationStr =
              typeof observation === 'string'
                ? observation
                : JSON.stringify(observation);
            const result = JSON.parse(observationStr) as unknown;

            // Type guard to check if result has designId property
            if (
              result &&
              typeof result === 'object' &&
              'designId' in result &&
              typeof (result as { designId: unknown }).designId === 'string'
            ) {
              const designId = (result as { designId: string }).designId;
              this.logger.log(`Found design ID in tool results: ${designId}`);
              return designId;
            }
          } catch {
            // Not valid JSON, continue
          }
        }
      }
      return null;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Error extracting design ID from tool results: ${errorMessage}`,
      );
      return null;
    }
  }

  /**
   * Extract design ID from agent output (fallback method)
   */
  private extractDesignId(output: string): string | null {
    try {
      // Try to parse as JSON first
      const jsonMatch = output.match(/\{[^}]*"designId":\s*"([^"]+)"[^}]*\}/);
      if (jsonMatch) {
        return jsonMatch[1];
      }

      // Try to find UUID pattern
      const uuidMatch = output.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      );
      if (uuidMatch) {
        return uuidMatch[0];
      }

      // Try to extract from "designId: xxx" pattern
      const idMatch = output.match(/designId:\s*([^\s,}]+)/i);
      if (idMatch) {
        return idMatch[1].replace(/['"]/g, '');
      }

      return null;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error extracting design ID: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Extract design name from agent output
   */
  private extractDesignName(output: string): string | null {
    try {
      const nameMatch = output.match(/"name":\s*"([^"]+)"/);
      if (nameMatch) {
        return nameMatch[1];
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Extract component count from agent output
   */
  private extractComponentCount(output: string): number {
    try {
      const match = output.match(/"itemsCount":\s*(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Extract connection count from agent output
   */
  private extractConnectionCount(output: string): number {
    try {
      const match = output.match(/"connectionsCount":\s*(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Extract reasoning steps from intermediate steps
   */
  private extractReasoningSteps(intermediateSteps: unknown[]): string[] {
    const steps: string[] = [];

    try {
      for (const step of intermediateSteps) {
        const stepObj = step as Record<string, unknown>;
        const action = stepObj.action as Record<string, unknown> | undefined;
        if (action && typeof action === 'object' && 'tool' in action) {
          const toolName = String(action.tool);
          const toolInput = JSON.stringify(action.toolInput || {});
          steps.push(`Used tool: ${toolName} with input: ${toolInput}`);
        }

        if ('observation' in stepObj) {
          const observation =
            typeof stepObj.observation === 'string'
              ? stepObj.observation.substring(0, 100)
              : JSON.stringify(stepObj.observation).substring(0, 100);
          steps.push(`Result: ${observation}...`);
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Error extracting reasoning steps: ${errorMessage}`);
    }

    return steps;
  }

  /**
   * Health check for agent service
   */
  async healthCheck(): Promise<{ status: string; model: string }> {
    try {
      // Check if agent is initialized
      if (!this.agentExecutor) {
        return {
          status: 'unhealthy - agent not initialized',
          model: process.env.OLLAMA_MODEL || 'mistral-nemo:latest',
        };
      }

      // Simple LLM call to verify it's working
      await this.llm.invoke('ping');
      return {
        status: 'healthy',
        model: process.env.OLLAMA_MODEL || 'mistral-nemo:latest',
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Health check failed: ${errorMessage}`);
      return {
        status: 'unhealthy',
        model: process.env.OLLAMA_MODEL || 'mistral-nemo:latest',
      };
    }
  }
}
