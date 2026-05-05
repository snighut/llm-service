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
import { AgentToolReplayStep, AgentTraceService } from './agent-trace.service';
import { GenerateDesignDto } from './dto/generate-design.dto';
import { DesignResultDto } from './dto/design-result.dto';
import { RagService } from '../llm/rag.service';

interface ArchitectApiDefinition {
  name: string;
  method: string;
  path: string;
  purpose: string;
  request?: Record<string, unknown>;
  responseMetadata?: Record<string, unknown>;
}

interface ArchitectAsyncWorkflow {
  name: string;
  trigger: string;
  queueOrStream: string;
  consumers: string[];
  outcome: string;
}

interface ArchitectBlueprint {
  actors: string[];
  functionalRequirements: string[];
  nonFunctionalRequirements: string[];
  scalabilityDecisions: string[];
  entities: Array<{
    name: string;
    purpose: string;
    keyFields: string[];
  }>;
  apis: ArchitectApiDefinition[];
  asyncWorkflows: ArchitectAsyncWorkflow[];
  recommendedDesignTypes: string[];
}

interface DesignValidationReport {
  score: number;
  passed: boolean;
  missingRequirements: string[];
  gaps: string[];
  recommendations: string[];
}

interface DesignValidationIssueBundle {
  missingRequirements: string[];
  gaps: string[];
  recommendations: string[];
  penalty: number;
  criticalIssueCount: number;
}

interface ContextMechanismExpectation {
  requirement: string;
  evidencePatterns: string[];
  recommendation: string;
  critical: boolean;
}

interface ArchitectureContextDossier {
  explicitQuestions: string[];
  domainSignals: string[];
  mustHaveCapabilities: string[];
  riskHotspots: string[];
  ragInsights: string[];
  expectations: ContextMechanismExpectation[];
}

interface MultiAgentAttempt {
  attempt: number;
  designId: string;
  output: string;
  intermediateSteps: unknown[];
  mutationInput: Record<string, unknown> | null;
  blueprint: ArchitectBlueprint;
  design: Record<string, unknown>;
  validation: DesignValidationReport;
  reasoning: string[];
}

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
  private readonly modelName: string;

  constructor(
    private readonly designToolsService: DesignToolsService,
    private readonly ragService: RagService,
    private readonly traceService: AgentTraceService,
  ) {
    // Determine which LLM provider to use
    this.provider = process.env.LLM_PROVIDER || 'ollama';

    // Initialize LLM based on provider
    if (this.provider === 'openai') {
      this.modelName = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      this.llm = new ChatOpenAI({
        modelName: this.modelName,
        temperature: 0.7,
        openAIApiKey: process.env.OPENAI_API_KEY,
      });
      this.logger.log(`Agent initialized with OpenAI model: ${this.modelName}`);
    } else {
      this.modelName = process.env.OLLAMA_MODEL || 'mistral-nemo:latest';
      this.llm = new ChatOllama({
        baseUrl: process.env.OLLAMA_HOST || 'http://localhost:11434',
        model: this.modelName,
        temperature: 0.7,
      });
      this.logger.log(`Agent initialized with Ollama model: ${this.modelName}`);
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
  private createAgentExecutor(
    accessToken: string,
    maxIterations = 15,
    mode: 'create' | 'update' | 'both' = 'both',
  ): AgentExecutor {
    try {
      const tools = this.designToolsService.getAllTools(accessToken, mode);

      // System prompt that guides the agent's behavior
      const prompt = ChatPromptTemplate.fromMessages([
        [
          'system',
          `You are an expert system architect AI agent that creates detailed, production-quality visual architecture diagrams.

Your capabilities:
- Search existing design templates in the database
- Analyze and learn from existing designs
- Create comprehensive system architecture designs with components and connections
- Update an existing design during refinement loops using the same design ID

CRITICAL: Your ONLY job is to create or update visual system designs using create_system_design or update_system_design tools. Do NOT provide textual explanations.

MANDATORY ENRICHED CONTEXT:
- For EVERY item in items[], include context object with keys:
  - purpose
  - limitations
  - alternatives
  - scalingPlan
- If a requested design type is missing from supported visual types, use type: "text-box" and encode missing design type info in item.context.

Your workflow:
1. Understand the user's requirements
2. (Optional) Search similar designs: search_existing_designs tool
3. (Optional) Analyze templates: get_design_by_id tool
4. Plan a complete architecture based on requirements
5. **IMPORTANT**: If the architecture has 6+ components, organize them into logical design groups
6. For a brand new design, call create_system_design. For refinement attempts with a provided target design ID, call update_system_design with that same designId.

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
      "connectionType": string (optional - connection type: "synchronousCall", "asynchronousCall", "requestResponse", "publishSubscribe", "controlFlow", "messageFlow", "eventFlow", "dependency", "association", etc.)
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

The update_system_design tool uses the same schema plus:
{{
  "designId": string (REQUIRED - existing design UUID to update)
}}

CRITICAL RULES:
1. items[].type is REQUIRED and must be one of the enum values
2. connections[].from and connections[].to are STRINGS (component names), NOT objects
3. ALWAYS provide x, y coordinates for each item to ensure clean layout without overlapping connections
4. Don't include "uidata", "fromPoint", "toPoint" - those are added by the backend
5. Use designGroups to organize related components (e.g., group all backend services, databases, etc.)
6. NEVER set items[].context to null. Every item must include context with non-empty strings for purpose, limitations, alternatives, and scalingPlan.
7. Cache semantics: service -> cache and service -> database fallback are valid. Avoid cache -> database "read" edges.
8. CDN is allowed only when the design has client-facing nodes (web-app/mobile-app/user/frontend) or explicit static/content delivery requirements.
9. Load balancer is valid only when routing to multiple upstream services/instances or when user explicitly asks for traffic distribution/high availability.
10. During refinement updates, do not collapse architecture scope. Keep or improve component coverage; never submit an update payload that shrinks to a tiny subset unless explicitly asked.
11. Entity-owning services (for example user/post/follow/comment/like/feed) must connect to a durable store (database/storage) via explicit service -> persistence edges.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SEMANTIC FEW-SHOT EXAMPLES (FOLLOW THESE PATTERNS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BAD EXAMPLE (DO NOT DO THIS):
- item context is null
- cache reads from database directly
- CDN included without client/static requirement
- load balancer with single downstream target

{{
  "name": "Bad Example",
  "items": [
    {{ "name": "API Gateway", "type": "api-gateway", "x": 100, "y": 100, "context": null }},
    {{ "name": "Catalog Service", "type": "microservice", "x": 320, "y": 100, "context": null }},
    {{ "name": "Cache", "type": "cache", "x": 540, "y": 60, "context": null }},
    {{ "name": "Catalog DB", "type": "database", "x": 540, "y": 160, "context": null }},
    {{ "name": "CDN", "type": "cdn", "x": 760, "y": 60, "context": null }},
    {{ "name": "Load Balancer", "type": "load-balancer", "x": 100, "y": 220, "context": null }}
  ],
  "connections": [
    {{ "from": "Cache", "to": "Catalog DB", "label": "Cache Reads" }},
    {{ "from": "Load Balancer", "to": "API Gateway", "label": "Distribute Traffic" }}
  ]
}}

GOOD EXAMPLE (DO THIS):
- every item has context with purpose/limitations/alternatives/scalingPlan
- read path is service -> cache and service -> database fallback
- CDN used only with a web/mobile/user flow
- load balancer routes to 2+ upstream targets

{{
  "name": "Good Example",
  "items": [
    {{ "name": "Web App", "type": "web-app", "x": 80, "y": 80, "context": {{ "purpose": "User interface for browsing products", "limitations": "Depends on API availability", "alternatives": "Mobile app or server-rendered web", "scalingPlan": "Serve static assets via CDN and autoscale web tier" }} }},
    {{ "name": "CDN", "type": "cdn", "x": 240, "y": 80, "context": {{ "purpose": "Low-latency delivery of static assets", "limitations": "Not for transactional writes", "alternatives": "Regional edge cache", "scalingPlan": "Global edge distribution and cache invalidation strategy" }} }},
    {{ "name": "Load Balancer", "type": "load-balancer", "x": 240, "y": 200, "context": {{ "purpose": "Distribute API traffic across gateways", "limitations": "Adds one network hop", "alternatives": "Anycast gateway", "scalingPlan": "Scale horizontally with health checks" }} }},
    {{ "name": "API Gateway A", "type": "api-gateway", "x": 420, "y": 160, "context": {{ "purpose": "Primary gateway instance", "limitations": "Throughput bound per instance", "alternatives": "Service mesh ingress", "scalingPlan": "Replicate gateway instances under load" }} }},
    {{ "name": "API Gateway B", "type": "api-gateway", "x": 420, "y": 240, "context": {{ "purpose": "Secondary gateway instance", "limitations": "Requires config sync", "alternatives": "Managed API gateway", "scalingPlan": "Autoscale with shared config" }} }},
    {{ "name": "Catalog Service", "type": "microservice", "x": 620, "y": 200, "context": {{ "purpose": "Serve catalog reads and writes", "limitations": "DB latency affects p99", "alternatives": "Monolith module", "scalingPlan": "Stateless horizontal replicas" }} }},
    {{ "name": "Cache", "type": "cache", "x": 820, "y": 140, "context": {{ "purpose": "Fast read cache for catalog", "limitations": "Eventual consistency", "alternatives": "In-memory local cache", "scalingPlan": "Shard by keyspace and tune TTL" }} }},
    {{ "name": "Catalog DB", "type": "database", "x": 820, "y": 260, "context": {{ "purpose": "System of record for catalog", "limitations": "Write capacity constraints", "alternatives": "Managed document DB", "scalingPlan": "Read replicas and partitioning" }} }}
  ],
  "connections": [
    {{ "from": "Web App", "to": "CDN", "label": "Static Assets" }},
    {{ "from": "Load Balancer", "to": "API Gateway A", "label": "Route" }},
    {{ "from": "Load Balancer", "to": "API Gateway B", "label": "Route" }},
    {{ "from": "API Gateway A", "to": "Catalog Service", "label": "REST API" }},
    {{ "from": "API Gateway B", "to": "Catalog Service", "label": "REST API" }},
    {{ "from": "Catalog Service", "to": "Cache", "label": "Read-Through Cache" }},
    {{ "from": "Catalog Service", "to": "Catalog DB", "label": "DB Fallback + Writes" }}
  ]
}}

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
    {{"name": "MySQL", "type": "database", "x": 600, "y": 100}},
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
CONNECTION LABELS & TYPES - Be Descriptive About System Characteristics!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ CRITICAL: Connection labels should describe WHAT is transferred AND key characteristics!

ENHANCED CONNECTION LABELS (Include System Characteristics):

BASIC LABELS (minimum):
- API Gateway → Service: "REST API", "gRPC", "GraphQL"
- Service → Database: "SQL Query", "NoSQL", "Read/Write"
- Service → Cache: "Cache Lookup", "Get/Set"
- Service → Queue: "Publish", "Subscribe", "Enqueue"

DESCRIPTIVE LABELS (preferred - include performance/flow info):

**With Throughput:**
- "REST API (10K req/s)"
- "Event Stream (50K msg/s)"
- "Write (1M rows/day)"
- "High-Throughput Ingest"

**With Latency Requirements:**
- "REST API (<50ms)"
- "Cache Hit (<5ms)"
- "Sync Call (<100ms)"
- "Low-Latency Read"

**With Rate Limiting:**
- "Rate Limited (1K/min)"
- "Throttled API (100/sec)"
- "Quota: 10K/day"

**With Flow Patterns:**
- "Async Publish"
- "Batched Write"
- "Streaming Data"
- "Fire-and-Forget"
- "Request-Response"
- "Fan-Out Events"

**With Consistency/Reliability:**
- "Sync Write (strong consistency)"
- "Async Write (eventual)"
- "Write-Through Cache"
- "Cache-Aside Read"
- "Retry on Failure"
- "Circuit Breaker"

**With Protocol Details:**
- "REST/JSON"
- "gRPC/Protobuf"
- "WebSocket (bidirectional)"
- "HTTP/2 Streaming"
- "TCP Keep-Alive"

EXAMPLES OF GOOD CONNECTION LABELS:

Simple System:
- "REST API" → Basic label
- "SQL Query" → Basic label

Medium Complexity:
- "REST API (<100ms)" → With latency
- "Cache-Aside Read" → With caching strategy
- "Async Publish" → With flow pattern

High-Scale System:
- "REST API (10K/sec, <50ms)" → Throughput + latency
- "Rate Limited (1K/min)" → With throttling
- "Event Stream (50K msg/s)" → High throughput streaming
- "Write-Through Cache" → Caching strategy
- "Batched Insert (1M/day)" → Batched writes with volume
- "gRPC (<10ms, circuit breaker)" → Protocol + latency + resilience

Connection types (optional connectionType field) define visual style and semantic meaning:
- "synchronousCall" → Sync request-response (solid line) - Use for HTTP APIs, REST, gRPC, GraphQL
- "asynchronousCall" → Async communication (dashed line) - Use for message queues, Kafka, RabbitMQ
- "requestResponse" → Request-response pattern (double arrows)
- "publishSubscribe" → Pub/sub pattern (dashed line) - Use for event buses, SNS/SQS
- "controlFlow" → Control/execution flow (bold arrow)
- "messageFlow" → Message passing (dotted line)
- "eventFlow" → Event-driven (dashed line with lightning)
- "association" → Basic relationship
- "dependency" → Weak relationship (dashed)
- "looseCoupling" → Loosely coupled (light dashed)
- "tightCoupling" → Tightly coupled (thick solid)
- "default" → Default connection style

COMBINE LABEL + TYPE for best results:
{{
  "from": "API Gateway",
  "to": "User Service",
  "label": "REST API (<50ms, Rate Limited 1K/min)",
  "connectionType": "synchronousCall"
}},
{{
  "from": "Order Service",
  "to": "Kafka",
  "label": "Async Event Stream (50K msg/s)",
  "connectionType": "asynchronousCall"
}},
{{
  "from": "Feed Service",
  "to": "Redis",
  "label": "Cache-Aside (<5ms)",
  "connectionType": "synchronousCall"
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
    {{"from": "API Gateway", "to": "Service 1", "label": "Route", "connectionType": "synchronousCall"}},
    {{"from": "API Gateway", "to": "Service 2", "label": "Route", "connectionType": "synchronousCall"}},
    {{"from": "Service 1", "to": "Database", "label": "DB Access", "connectionType": "synchronousCall"}},
    {{"from": "Service 2", "to": "Database", "label": "DB Access", "connectionType": "synchronousCall"}}
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
    {{"name": "MongoDB", "type": "database", "x": 740, "y": 100}},
    {{"name": "Kafka Queue", "type": "message-queue", "x": 740, "y": 180}},
    {{"name": "Batch Worker", "type": "microservice", "x": 900, "y": 180}}
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
    {{"from": "Load Balancer", "to": "API Gateway", "label": "L7 LB (Round Robin, <10ms)", "connectionType": "synchronousCall"}},
    {{"from": "API Gateway", "to": "User Service", "label": "REST (Rate Limited 5K/min)", "connectionType": "synchronousCall"}},
    {{"from": "API Gateway", "to": "Order Service", "label": "REST (Rate Limited 2K/min)", "connectionType": "synchronousCall"}},
    {{"from": "API Gateway", "to": "Product Service", "label": "REST (<30ms, Cached)", "connectionType": "synchronousCall"}},
    {{"from": "API Gateway", "to": "Cart Service", "label": "REST (<50ms, Session)", "connectionType": "synchronousCall"}},
    {{"from": "User Service", "to": "Redis Cache", "label": "Cache-Aside (<5ms)", "connectionType": "synchronousCall"}},
    {{"from": "Product Service", "to": "Redis Cache", "label": "Write-Through Cache", "connectionType": "synchronousCall"}},
    {{"from": "Order Service", "to": "MongoDB", "label": "NoSQL Write (eventual)", "connectionType": "asynchronousCall"}},
    {{"from": "User Service", "to": "MongoDB", "label": "NoSQL Read (<20ms)", "connectionType": "synchronousCall"}},
    {{"from": "Order Service", "to": "Payment Service", "label": "Sync HTTP (retry: 3x)", "connectionType": "synchronousCall"}},
    {{"from": "Order Service", "to": "Kafka Queue", "label": "Async Event (50K msg/s)", "connectionType": "asynchronousCall"}},
    {{"from": "Kafka Queue", "to": "Batch Worker", "label": "Consumer Group (at-least-once)", "connectionType": "asynchronousCall"}},
    {{"from": "Batch Worker", "to": "MongoDB", "label": "Batch Upsert (1K/batch)", "connectionType": "synchronousCall"}},
    {{"from": "MongoDB", "to": "Datadog", "label": "Metrics Push (1min interval)", "connectionType": "asynchronousCall"}}
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
    {{"name": "DynamoDB", "type": "database", "x": 500, "y": 100}},
    {{"name": "Redis Cache", "type": "cache", "x": 500, "y": 200}},
    {{"name": "Message Queue", "type": "message-queue", "x": 700, "y": 150}}
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
      "description": "Messaging infrastructure",
      "x": 680,
      "y": 80,
      "borderColor": "#4CAF50"
    }}
  ],
  "connections": [
    {{"from": "API Gateway", "to": "User Service", "label": "REST (<100ms, Rate Limited 5K/min)", "connectionType": "synchronousCall"}},
    {{"from": "API Gateway", "to": "Tweet Service", "label": "REST (Rate Limited 1K/min)", "connectionType": "synchronousCall"}},
    {{"from": "API Gateway", "to": "Feed Service", "label": "REST (<50ms, High Read)", "connectionType": "synchronousCall"}},
    {{"from": "User Service", "to": "DynamoDB", "label": "NoSQL Read (<20ms)", "connectionType": "synchronousCall"}},
    {{"from": "Tweet Service", "to": "DynamoDB", "label": "NoSQL Write (eventual)", "connectionType": "asynchronousCall"}},
    {{"from": "Feed Service", "to": "Redis Cache", "label": "Cache-Aside (<5ms)", "connectionType": "synchronousCall"}},
    {{"from": "Tweet Service", "to": "Message Queue", "label": "Async Event (100K msg/s)", "connectionType": "asynchronousCall"}},
    {{"from": "Message Queue", "to": "Feed Service", "label": "Fan-Out Subscribe", "connectionType": "asynchronousCall"}}
  ]
}}

Example 4: CI/CD Pipeline (5 components) - Linear Flow (No Design Groups Needed)
{{
  "name": "CI/CD Pipeline Flow",
  "description": "Continuous Integration and Deployment pipeline",
  "items": [
    {{"name": "Source Code", "type": "storage", "x": 100, "y": 100}},
    {{"name": "CI Server", "type": "container", "x": 280, "y": 100}},
    {{"name": "CD Server", "type": "container", "x": 460, "y": 100}},
    {{"name": "Production", "type": "kubernetes", "x": 640, "y": 100}}
  ],
  "connections": [
    {{"from": "Source Code", "to": "CI Server", "label": "Git Push"}},
    {{"from": "CI Server", "to": "CD Server", "label": "Artifact Deploy"}},
    {{"from": "CD Server", "to": "Production", "label": "K8s Rollout"}}
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
    {{"name": "Cassandra", "type": "database", "x": 820, "y": 80}},
    {{"name": "Redis Cache", "type": "cache", "x": 820, "y": 160}}
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
    {{"from": "API Gateway", "to": "Order Service", "label": "REST API", "connectionType": "synchronousCall"}},
    {{"from": "API Gateway", "to": "Inventory Service", "label": "REST API", "connectionType": "synchronousCall"}},
    {{"from": "Order Service", "to": "Event Bus", "label": "Publish", "connectionType": "publishSubscribe"}},
    {{"from": "Inventory Service", "to": "Event Bus", "label": "Publish", "connectionType": "publishSubscribe"}},
    {{"from": "Event Bus", "to": "Notification Service", "label": "Subscribe", "connectionType": "publishSubscribe"}},
    {{"from": "Event Bus", "to": "Analytics Service", "label": "Subscribe", "connectionType": "publishSubscribe"}},
    {{"from": "Notification Service", "to": "Cassandra", "label": "CQL", "connectionType": "synchronousCall"}},
    {{"from": "Analytics Service", "to": "Redis Cache", "label": "Cache", "connectionType": "synchronousCall"}}
  ]
}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ADVANCED ARCHITECTURAL PATTERNS - Think Beyond CRUD Apps!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ CRITICAL: Don't default to basic API + Service + PostgreSQL patterns. Consider the ACTUAL use case!

DATABASE SELECTION BY TYPE (Choose the right database for the job!):

SQL DATABASES (Relational):
- "PostgreSQL" / "MySQL" → ACID transactions, complex joins, financial data, orders
- Use when: Strong consistency, relationships, structured schemas

NoSQL DATABASES (Choose by data model):
- "MongoDB" / "DynamoDB" → Document stores for flexible schemas, user profiles, catalogs
- "Cassandra" / "ScyllaDB" → Wide-column stores for time-series, IoT, high write throughput
- "Redis" → In-memory database for real-time data, session stores, leaderboards, pub/sub
- "Elasticsearch" → Full-text search, log aggregation, analytics queries

SPECIALIZED DATABASES:
- "Neo4j" → Graph database for social networks, recommendations, fraud detection
- Name databases specifically (e.g., "Cassandra", "MongoDB", "Redis Cache", "Elasticsearch")

CACHING STRATEGIES (Choose based on read/write patterns):
- **Cache-Aside (Lazy Loading)**: App checks cache, loads from DB on miss (most common)
  → Use for: Read-heavy workloads, unpredictable access patterns
- **Write-Through**: Write to cache AND database simultaneously
  → Use for: Read-heavy with occasional writes, strong consistency needed
- **Write-Behind (Write-Back)**: Write to cache, async persist to DB
  → Use for: High write throughput, can tolerate eventual consistency
- **Write-Around**: Write directly to DB, bypass cache
  → Use for: Write-heavy workloads, data read infrequently
- Label cache connections: "Cache-Aside", "Write-Through Cache", etc.

CDN & CONTENT DELIVERY (For static assets, media, global distribution):
- "CloudFront CDN" / "Akamai CDN" / "Cloudflare CDN" → Global edge caching
- Use for: Images, videos, static files, API responses
- Consider: Multi-region deployments, edge computing, DDoS protection

PERFORMANCE & RELIABILITY CONSIDERATIONS:

**THROUGHPUT & LATENCY**:
- High throughput needs → Add load balancers, horizontal scaling, message queues
- Low latency needs → Add caching layers, CDN, in-memory databases (Redis)
- Include performance targets in design

**FAULT TOLERANCE & RELIABILITY**:
- Multi-region deployments → Show multiple load balancers/servers
- Database replication → Add "DB Replica" components
- Circuit breakers → Service-to-service resilience
- Health checks → Monitoring service tracking availability

**RATE LIMITING & THROTTLING**:
- Add "Rate Limiter" component for public APIs
- Use API Gateway with rate limiting features
- Prevent abuse, ensure fair usage, protect backend services

**HASHING & DISTRIBUTION**:
- Consistent hashing for cache partitioning
- Sharding strategies for databases
- Load balancing algorithms (round-robin, least connections)

**SECURITY & NETWORKING**:
- "VPN Gateway" → Secure connectivity between on-prem and cloud
- "Firewall" → Network security, DDoS protection
- "API Gateway" → Authentication, authorization, request validation

COMMON ARCHITECTURAL PATTERNS:

1. MEDIA STREAMING PLATFORM (Netflix/YouTube style):
   → Use: CDN, Storage (S3), Web/Mobile Apps, API Gateway, Microservices, Cache, Database
   → Include: Video transcoding service, thumbnail generation, recommendation engine
   → Database: MongoDB for metadata, Cassandra for viewing history

2. E-COMMERCE WITH IMAGE UPLOAD:
   → Use: Storage (S3), CDN, Load Balancer, Microservices, Cache, Database, Message Queue
   → Include: Image processing service, payment gateway, order service, inventory
   → Database: PostgreSQL for orders/inventory, MongoDB for product catalog

3. SAAS WITH OBSERVABILITY:
   → Use: Monitor (Datadog/Grafana), API Gateway, Microservices, Database, Cache
   → Include: Logging service, tracing service, metrics aggregation, alerting
   → Database: Elasticsearch for logs, PostgreSQL for app data

4. REAL-TIME ANALYTICS PIPELINE:
   → Use: Message Queue (Kafka), Lambda, Storage, Database, Monitor
   → Include: Stream processors, data transformers, aggregators, dashboards
   → Database: Cassandra for time-series, Redis for real-time counters

5. BATCH PROCESSING SYSTEM:
   → Use: Message Queue, Lambda/Container, Storage, Database, Monitor
   → Include: Job scheduler, worker pools, retry logic, dead letter queues
   → Database: PostgreSQL for job metadata, S3 for data lakes

6. MOBILE APP BACKEND:
   → Use: Mobile App, API Gateway, CDN, Microservices, Cache, Database, Storage
   → Include: Push notification service, image CDN, auth service, analytics
   → Database: DynamoDB for user data, S3 for media storage

7. SOCIAL MEDIA PLATFORM:
   → Use: Load Balancer, API Gateway, Microservices, Cache, Database, Message Queue, CDN
   → Include: Feed generation, content moderation, recommendation, search
   → Database: Cassandra for posts/feeds, Redis for trending topics, Elasticsearch for search

8. HIGH-THROUGHPUT SYSTEM WITH RATE LIMITING:
   → Use: Load Balancer, Rate Limiter, API Gateway, Microservices, Cache, Database
   → Include: Request throttling, circuit breakers, health monitoring
   → Database: Cassandra for high writes, Redis for rate limit counters
   → Caching: Write-through cache for critical data

9. GLOBALLY DISTRIBUTED APP (Multi-Region):
   → Use: CloudFront CDN, VPN Gateway, Load Balancers (per region), Microservices, DB Replicas
   → Include: Geo-routing, database replication, failover mechanisms
   → Database: DynamoDB with global tables, read replicas
   → Focus: Low latency, fault tolerance, disaster recovery

10. REAL-TIME GAMING/LEADERBOARD:
    → Use: Load Balancer, API Gateway, Microservices, Redis (in-memory), Message Queue
    → Include: WebSocket service, ranking service, real-time updates
    → Database: Redis for leaderboards, Cassandra for match history
    → Caching: Write-behind for high score updates

11. IOT DATA INGESTION:
    → Use: Message Queue (Kafka), Stream Processor, Storage, Database (wide-column), Monitor
    → Include: Data validation, aggregation, alerting
    → Database: Cassandra/ScyllaDB for time-series sensor data
    → Focus: High write throughput, data retention policies

12. RECOMMENDATION ENGINE:
    → Use: API Gateway, Microservices, Graph Database, Cache, Message Queue, Storage
    → Include: ML inference service, feature store, A/B testing
    → Database: Neo4j for relationships, Redis for candidate cache
    → Focus: Low latency recommendations, personalization

COMPLEXITY GUIDELINES:

Simple (3-5 components): Basic CRUD apps ONLY
- Linear flow: Client → API → Service → Database
- x spacing: 100, 300, 500

Medium (6-10 components): Most real-world apps
- Include caching, queuing, or specialized services  
- Consider: Cache strategy, database type (based on use case)
- x spacing: 100, 280, 460, 640
- y spread: 60, 100, 140, 180

Complex (10-15+ components): Production-scale systems
- Multiple data stores, async processing, specialized services
- MUST consider: Database type selection, caching strategy, fault tolerance
- OPTIONALLY include (only if contextually relevant): Monitoring, CDN, VPN, Rate limiting
- x spacing: 50, 200, 380, 560, 740, 900, 1050+
- y spread: 40-300 pixel range

High-Performance (15+ components): Enterprise/Global scale
- Multi-region, database replicas, advanced caching
- Focus on: Throughput, latency, reliability, security
- Include: Load balancers, rate limiters, circuit breakers, health checks
- Only add monitoring/observability if user explicitly requests it

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL RESPONSE RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. ALWAYS call exactly one design mutation tool - create_system_design or update_system_design.
1a. Call a design mutation tool exactly ONCE per attempt, then stop tool usage for that attempt and return the design ID sentence.
2. NEVER provide textual explanations or architectural descriptions
3. After tool call, respond with ONLY: "Design created with ID: <designId>"
4. DO NOT explain components, connections, or technical details
5. DO NOT use markdown formatting
6. ONLY return the design ID sentence
7. DO NOT always include Monitoring/Datadog - only add when user explicitly requests observability, metrics, or monitoring

AVOID ALWAYS INCLUDING:
- Monitoring/Datadog (only if user asks for observability)
- CDN (only if user mentions content delivery, static assets, or global distribution)
- VPN (only if user mentions security, private networking)
- Load Balancer (only for high-scale, traffic distribution scenarios)

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
        maxIterations, // Prevent infinite loops
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
    userId?: string,
  ): Promise<DesignResultDto> {
    const startTime = Date.now();
    this.logger.log(`Generating design for query: ${dto.query}`);

    const traceRunId = this.traceService.startRun({
      userId,
      query: dto.query,
      provider: this.provider,
      model: this.modelName,
    });
    this.traceService.appendStage(traceRunId, 'request_received', {
      queryLength: dto.query.length,
    });

    if (!accessToken) {
      this.traceService.failRun(traceRunId, 'Access token is required');
      throw new Error('Access token is required for design generation');
    }

    try {
      const validationEnabled = dto.options?.enableValidationLoop !== false;
      const validationThreshold = this.normalizeScoreThreshold(
        dto.options?.validationThreshold,
        85,
      );
      const maxRefinementCycles = this.normalizePositiveInt(
        dto.options?.maxRefinementCycles,
        3,
      );
      const maxDesignerIterations = this.normalizePositiveInt(
        dto.options?.maxIterations,
        15,
      );
      const totalAttempts = validationEnabled ? maxRefinementCycles + 1 : 1;

      this.traceService.appendStage(traceRunId, 'runtime_config_resolved', {
        validationEnabled,
        validationThreshold,
        maxRefinementCycles,
        maxDesignerIterations,
        totalAttempts,
      });

      const ragContext =
        dto.options?.enableRagContext === false
          ? ''
          : await this.getRagContext(dto.query);

      this.traceService.appendStage(traceRunId, 'rag_context_loaded', {
        enabled: dto.options?.enableRagContext !== false,
        contextLength: ragContext.length,
      });

      const contextDossier = this.buildContextDossier(dto.query, ragContext);
      this.traceService.appendStage(traceRunId, 'context_dossier_built', {
        explicitQuestions: contextDossier.explicitQuestions.length,
        domainSignals: contextDossier.domainSignals.length,
        mustHaveCapabilities: contextDossier.mustHaveCapabilities.length,
        expectations: contextDossier.expectations.length,
      });

      let blueprint = await this.generateBlueprint(
        dto.query,
        ragContext,
        contextDossier,
      );
      this.traceService.appendStage(traceRunId, 'blueprint_generated', {
        actors: blueprint.actors.length,
        functionalRequirements: blueprint.functionalRequirements.length,
        apis: blueprint.apis.length,
        asyncWorkflows: blueprint.asyncWorkflows.length,
      });

      let refinementDirectives: string[] = [];
      let bestAttempt: MultiAgentAttempt | null = null;
      let activeDesignId: string | null = null;
      const attemptHistory: Array<{
        attempt: number;
        designId: string;
        validationScore: number;
        passed: boolean;
        missingRequirementsCount: number;
        gapCount: number;
      }> = [];

      for (let attempt = 1; attempt <= totalAttempts; attempt++) {
        this.traceService.appendStage(traceRunId, 'attempt_started', {
          attempt,
          totalAttempts,
          directivesCount: refinementDirectives.length,
        });

        const planningSummary = this.buildPlanningSummary(
          blueprint,
          contextDossier,
        );
        const toolMode: 'create' | 'update' =
          attempt === 1 ? 'create' : 'update';

        // DesignerAgent
        const designerExecutor = this.createAgentExecutor(
          accessToken,
          maxDesignerIterations,
          toolMode,
        );

        const enrichedInput = [
          `User query: ${dto.query}`,
          'Follow this architecture brief strictly:',
          planningSummary,
          refinementDirectives.length
            ? `Refiner directives for this attempt:\n- ${refinementDirectives.join('\n- ')}`
            : '',
          activeDesignId
            ? `Refinement target design ID: ${activeDesignId}\nMANDATORY FOR THIS ATTEMPT: call update_system_design with designId="${activeDesignId}" and the full updated architecture payload. Do NOT call create_system_design.`
            : 'This is the initial attempt. Create a new design with create_system_design.',
          'Hard requirements:',
          this.formatContextChecklist(contextDossier),
          '- Select database strategy explicitly for read-heavy vs write-heavy workloads.',
          '- Prefer async workflows (queue/stream/workers/notifications) for long-running operations.',
          '- Include caching/CDN/coalescing/presigned URL strategies when relevant to latency and throughput.',
          '- If the query asks explicit architecture questions, answer each with concrete mechanisms represented in components, connections, and context.',
          '- Ensure each generated item has context: purpose, limitations, alternatives, scalingPlan.',
          '- Use precise naming by type: keep "Service" suffix for compute/business services only; name data-plane nodes as Database/Storage/Cache/Queue/CDN/Telemetry (not "... Service").',
          '- Ingress direction is mandatory: client -> load balancer -> API gateway -> services. Never create API Gateway -> Load Balancer request routing.',
          '- Do not leave orphan components: every non-legend item must have at least one incoming or outgoing connection, or be removed.',
        ]
          .filter(Boolean)
          .join('\n\n');

        const result = await designerExecutor.invoke({
          input: enrichedInput,
          chat_history: [],
        });

        this.logger.log(
          `DesignerAgent attempt ${attempt}/${totalAttempts} completed`,
        );

        const intermediateSteps = Array.isArray(result.intermediateSteps)
          ? result.intermediateSteps
          : [];

        const replaySteps = this.extractToolReplaySteps(intermediateSteps);
        this.traceService.appendToolReplay(traceRunId, replaySteps);
        this.traceService.appendStage(traceRunId, 'designer_completed', {
          attempt,
          toolCalls: replaySteps.length,
          outputPreview: String(result.output).slice(0, 400),
        });

        const designId =
          this.extractDesignIdFromToolResults(intermediateSteps) ||
          this.extractDesignId(String(result.output));

        if (!designId) {
          throw new Error(
            `DesignerAgent attempt ${attempt} failed to return a design ID.`,
          );
        }

        activeDesignId = designId;

        const createdDesign = await this.designToolsService.fetchDesignById(
          accessToken,
          designId,
        );

        const latestMutationInput =
          this.extractLatestMutationToolInput(intermediateSteps);
        const designForValidation = this.hydrateDesignFromMutationInput(
          createdDesign,
          latestMutationInput,
        );

        // ValidatorAgent
        const validation = validationEnabled
          ? await this.validateDesignAgainstRequirements(
              dto.query,
              blueprint,
              designForValidation,
              contextDossier,
            )
          : {
              score: 100,
              passed: true,
              missingRequirements: [],
              gaps: [],
              recommendations: ['Validation loop disabled by request options'],
            };

        this.traceService.appendStage(traceRunId, 'validation_completed', {
          attempt,
          score: validation.score,
          passed: validation.passed,
          missingRequirementsCount: validation.missingRequirements.length,
          gapCount: validation.gaps.length,
        });

        const reasoning = this.extractReasoningSteps(intermediateSteps);

        const attemptResult: MultiAgentAttempt = {
          attempt,
          designId,
          output: String(result.output),
          intermediateSteps,
          mutationInput: latestMutationInput,
          blueprint,
          design: designForValidation,
          validation,
          reasoning,
        };

        attemptHistory.push({
          attempt,
          designId,
          validationScore: validation.score,
          passed: validation.passed,
          missingRequirementsCount: validation.missingRequirements.length,
          gapCount: validation.gaps.length,
        });

        if (!bestAttempt || this.isBetterAttempt(attemptResult, bestAttempt)) {
          bestAttempt = attemptResult;
        }

        const thresholdMet =
          !validationEnabled || validation.score >= validationThreshold;

        if (thresholdMet || attempt === totalAttempts) {
          this.traceService.appendStage(traceRunId, 'attempt_selected', {
            attempt,
            thresholdMet,
            finalAttempt: attempt === totalAttempts,
          });
          break;
        }

        // RefinerAgent
        refinementDirectives = await this.generateRefinementDirectives(
          dto.query,
          blueprint,
          validation,
          contextDossier,
        );

        this.traceService.appendStage(traceRunId, 'refinement_generated', {
          attempt,
          directivesCount: refinementDirectives.length,
        });

        blueprint = await this.applyRefinementToBlueprint(
          dto.query,
          blueprint,
          refinementDirectives,
          contextDossier,
        );

        this.traceService.appendStage(traceRunId, 'blueprint_refined', {
          attempt,
          actors: blueprint.actors.length,
          functionalRequirements: blueprint.functionalRequirements.length,
        });
      }

      if (!bestAttempt) {
        throw new Error(
          'Multi-agent orchestration failed: no design attempts were produced.',
        );
      }

      await this.promoteBestAttemptDesign(accessToken, traceRunId, bestAttempt);

      const designId = bestAttempt.designId;
      const validation = bestAttempt.validation;
      const reasoning = bestAttempt.reasoning;
      const selectedBlueprint = bestAttempt.blueprint;
      const selectedDesignItems = this.readDesignItems(bestAttempt.design);
      const selectedDesignConnections = this.readDesignConnections(
        bestAttempt.design,
      );
      const databaseNames = selectedDesignItems
        .filter((item) => item.type.toLowerCase() === 'database')
        .map((item) => item.name);

      // Build response
      const response: DesignResultDto = {
        designId,
        name: this.extractDesignName(bestAttempt.output) || 'Generated Design',
        message: 'Design created successfully',
        reasoning,
        metadata: {
          componentsCount: selectedDesignItems.length,
          connectionsCount: selectedDesignConnections.length,
          databaseCount: databaseNames.length,
          databaseNames,
          processingTimeMs: Date.now() - startTime,
          traceRunId,
          templateUsed: reasoning.some(
            (step) =>
              step.includes('template') || step.includes('existing design'),
          ),
          validationScore: validation.score,
          adrId: `ADR_${designId}`,
          validationThreshold,
          thresholdMet:
            !validationEnabled || validation.score >= validationThreshold,
          refinementCyclesUsed: Math.max(0, attemptHistory.length - 1),
        },
        validationDetails: {
          score: validation.score,
          passed: validation.passed,
          missingRequirements: validation.missingRequirements,
          gaps: validation.gaps,
          recommendations: validation.recommendations,
          attempts: attemptHistory,
        },
      };

      const adrBlob = {
        id: `ADR_${designId}`,
        designId,
        query: dto.query,
        generatedAt: new Date().toISOString(),
        blueprint: selectedBlueprint,
        validation,
        multiAgent: {
          enabled: true,
          validationEnabled,
          validationThreshold,
          maxRefinementCycles,
          attempts: attemptHistory,
        },
      };

      await this.designToolsService.attachDesignContext(accessToken, designId, {
        traceRunId,
        adr: adrBlob,
        architectureBlueprint: selectedBlueprint,
        validationReport: validation,
        contextDossier,
      });

      this.traceService.completeRun(traceRunId, {
        designId,
        validationScore: validation.score,
        attempts: attemptHistory.length,
      });

      this.logger.log(`Design generated successfully: ${designId}`);
      return response;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Error generating design: ${errorMessage}`, errorStack);
      this.traceService.failRun(traceRunId, errorMessage);
      throw error;
    }
  }

  private async getRagContext(query: string): Promise<string> {
    try {
      const docs = await this.ragService.getRelevantDocuments(query);
      const snippets = docs
        .slice(0, 5)
        .map((doc, index) => {
          const content =
            typeof doc?.payload?.page_content === 'string'
              ? doc.payload.page_content
              : '';
          return `RAG_${index + 1}: ${content.slice(0, 1200)}`;
        })
        .filter(Boolean);
      return snippets.join('\n\n');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `RAG context unavailable, proceeding without it: ${message}`,
      );
      return '';
    }
  }

  private async generateBlueprint(
    query: string,
    ragContext: string,
    contextDossier: ArchitectureContextDossier,
  ): Promise<ArchitectBlueprint> {
    const fallback: ArchitectBlueprint = {
      actors: ['End User'],
      functionalRequirements: ['Core request handling'],
      nonFunctionalRequirements: ['Scalability', 'Low latency', 'Reliability'],
      scalabilityDecisions: [
        'Use caching for read-heavy paths',
        'Use queue/stream for long-running operations',
      ],
      entities: [
        {
          name: 'PrimaryDomainEntity',
          purpose: 'Core business object',
          keyFields: ['id', 'createdAt', 'updatedAt'],
        },
      ],
      apis: [
        {
          name: 'GetResource',
          method: 'GET',
          path: '/api/v1/resources/{id}',
          purpose: 'Fetch resource details',
          responseMetadata: {
            requestId: 'uuid',
            timestamp: 'iso8601',
            latencyMs: 'number',
          },
        },
      ],
      asyncWorkflows: [
        {
          name: 'BackgroundProcessing',
          trigger: 'API request accepted',
          queueOrStream: 'message-queue',
          consumers: ['worker-service'],
          outcome: 'Async processing completed and user notified',
        },
      ],
      recommendedDesignTypes: ['microservices', 'event-driven'],
    };

    const prompt = `You are a principal system architect. Produce STRICT JSON only.

Given this system design request:
${query}

RAG context (can be empty):
${ragContext || 'N/A'}

Context dossier (derived from query + retrieval context, MUST honor this):
${JSON.stringify(contextDossier)}

Return JSON with this exact shape:
{
  "actors": string[],
  "functionalRequirements": string[],
  "nonFunctionalRequirements": string[],
  "scalabilityDecisions": string[],
  "entities": [{ "name": string, "purpose": string, "keyFields": string[] }],
  "apis": [{ "name": string, "method": string, "path": string, "purpose": string, "request": object, "responseMetadata": object }],
  "asyncWorkflows": [{ "name": string, "trigger": string, "queueOrStream": string, "consumers": string[], "outcome": string }],
  "recommendedDesignTypes": string[]
}

Rules:
- Include actors/roles across users + internal services.
- Include concrete functional requirements.
- Include non-functional requirements for million+ DAU scale.
- Include DB, coupling, async processing, caching/CDN/coalescing/presigned upload choices in scalabilityDecisions when applicable.
- If the query includes explicit questions (for example "How do we ...?"), map each question theme into functionalRequirements with implementation-level detail.
- Ensure context dossier expectations are represented concretely in requirements, APIs, entities, async workflows, or scalability decisions.
- Prefer concrete mechanisms over generic statements (examples: Base62 + unique index + collision retry, URL reputation checks, token-bucket rate limiting, TTL cleanup workers, hot-key sharding).
- If a design type may be unsupported in renderer, still include it in recommendedDesignTypes.
`;

    return this.invokeJsonPrompt(prompt, fallback);
  }

  private buildPlanningSummary(
    blueprint: ArchitectBlueprint,
    contextDossier: ArchitectureContextDossier,
  ): string {
    const lines: string[] = [];
    lines.push(`Actors: ${blueprint.actors.join(', ')}`);
    lines.push(
      `Functional requirements:\n- ${blueprint.functionalRequirements.join('\n- ')}`,
    );
    lines.push(
      `Non-functional requirements:\n- ${blueprint.nonFunctionalRequirements.join('\n- ')}`,
    );
    lines.push(
      `Scalability decisions:\n- ${blueprint.scalabilityDecisions.join('\n- ')}`,
    );
    lines.push(
      `Entities:\n- ${blueprint.entities
        .map((entity) => `${entity.name}: ${entity.purpose}`)
        .join('\n- ')}`,
    );
    lines.push(
      `APIs:\n- ${blueprint.apis
        .map((api) => `${api.method} ${api.path} (${api.purpose})`)
        .join('\n- ')}`,
    );
    lines.push(
      `Async workflows:\n- ${blueprint.asyncWorkflows
        .map((workflow) => `${workflow.name} via ${workflow.queueOrStream}`)
        .join('\n- ')}`,
    );
    lines.push(
      `Recommended design types: ${blueprint.recommendedDesignTypes.join(', ')}`,
    );
    lines.push(this.formatContextChecklist(contextDossier));
    return lines.join('\n\n');
  }

  private async generateRefinementDirectives(
    query: string,
    blueprint: ArchitectBlueprint,
    validation: DesignValidationReport,
    contextDossier: ArchitectureContextDossier,
  ): Promise<string[]> {
    const fallback = [
      'Add missing components and connections required by validator gaps.',
      'Ensure every design item has purpose, limitations, alternatives, and scalingPlan in context.',
      'Address missing functional requirements with explicit APIs or async workflows.',
    ];

    const prompt = `You are a RefinerAgent for system design quality.
Return STRICT JSON only as: { "directives": string[] }.

User request: ${query}
Blueprint:
${JSON.stringify(blueprint)}
Context dossier:
${JSON.stringify(contextDossier)}
Validation report:
${JSON.stringify(validation)}

Create concise, actionable directives for the next DesignerAgent attempt.
Prioritize fixing missingRequirements and gaps first.`;

    const parsed = await this.invokeJsonPrompt<{ directives?: string[] }>(
      prompt,
      { directives: fallback },
    );

    const directives = Array.isArray(parsed.directives)
      ? parsed.directives.filter(
          (directive): directive is string =>
            typeof directive === 'string' && directive.trim().length > 0,
        )
      : fallback;

    return directives.length > 0 ? directives : fallback;
  }

  private async applyRefinementToBlueprint(
    query: string,
    currentBlueprint: ArchitectBlueprint,
    directives: string[],
    contextDossier: ArchitectureContextDossier,
  ): Promise<ArchitectBlueprint> {
    if (!directives.length) {
      return currentBlueprint;
    }

    const prompt = `You are a PlannerAgent refining an architecture blueprint.
Return STRICT JSON only with EXACT blueprint schema.

User request: ${query}
Current blueprint:
${JSON.stringify(currentBlueprint)}

Refiner directives:
- ${directives.join('\n- ')}

Context dossier:
${JSON.stringify(contextDossier)}

Rules:
- Preserve valid existing blueprint details.
- Update actors/requirements/entities/apis/asyncWorkflows/recommendedDesignTypes to address directives.
- Ensure refined blueprint preserves coverage for context dossier expectations and explicit questions.
- Keep output practical for high-scale systems and maintain consistency.
`;

    return this.invokeJsonPrompt<ArchitectBlueprint>(prompt, currentBlueprint);
  }

  private async validateDesignAgainstRequirements(
    query: string,
    blueprint: ArchitectBlueprint,
    design: Record<string, unknown>,
    contextDossier: ArchitectureContextDossier,
  ): Promise<DesignValidationReport> {
    const fallback: DesignValidationReport = {
      score: 70,
      passed: true,
      missingRequirements: [],
      gaps: [],
      recommendations: [],
    };

    const prompt = `You are a strict architecture validator. Return STRICT JSON only.

User request: ${query}

Blueprint:
${JSON.stringify(blueprint)}

Context dossier:
${JSON.stringify(contextDossier)}

Generated design:
${JSON.stringify(design)}

Return JSON with exact shape:
{
  "score": number,
  "passed": boolean,
  "missingRequirements": string[],
  "gaps": string[],
  "recommendations": string[]
}

Rules:
- score is 0-100.
- Mark missing requirements not covered by components, connections, or contexts.
- Verify if generated items include purpose/limitations/alternatives/scaling context.
- Verify read-heavy/write-heavy DB choices, async workflows, and scale strategies where relevant.
`;

    const llmValidation = await this.invokeJsonPrompt(prompt, fallback);
    return this.applyDeterministicSemanticValidation(
      query,
      blueprint,
      design,
      contextDossier,
      llmValidation,
    );
  }

  private applyDeterministicSemanticValidation(
    query: string,
    blueprint: ArchitectBlueprint,
    design: Record<string, unknown>,
    contextDossier: ArchitectureContextDossier,
    llmValidation: DesignValidationReport,
  ): DesignValidationReport {
    const reconciledLlmValidation = this.reconcileLlmValidationFindings(
      llmValidation,
      blueprint,
      design,
    );

    const deterministic = this.evaluateDesignSemantics(
      query,
      blueprint,
      design,
      contextDossier,
    );

    const missingRequirements = Array.from(
      new Set([
        ...reconciledLlmValidation.missingRequirements,
        ...deterministic.missingRequirements,
      ]),
    );

    const gaps = Array.from(
      new Set([...reconciledLlmValidation.gaps, ...deterministic.gaps]),
    );

    const recommendations = Array.from(
      new Set([
        ...reconciledLlmValidation.recommendations,
        ...deterministic.recommendations,
      ]),
    );

    if (deterministic.penalty > 0 || deterministic.criticalIssueCount > 0) {
      recommendations.push(
        `Deterministic semantic checks applied penalty=${deterministic.penalty}, criticalIssues=${deterministic.criticalIssueCount}.`,
      );
    }

    const score = Math.max(
      0,
      reconciledLlmValidation.score - deterministic.penalty,
    );
    const passed =
      deterministic.criticalIssueCount === 0 &&
      missingRequirements.length === 0 &&
      gaps.length === 0;

    return {
      score,
      passed,
      missingRequirements,
      gaps,
      recommendations,
    };
  }

  private reconcileLlmValidationFindings(
    llmValidation: DesignValidationReport,
    blueprint: ArchitectBlueprint,
    design: Record<string, unknown>,
  ): DesignValidationReport {
    const items = this.readDesignItems(design);
    const connections = this.readDesignConnections(design);

    const hasAsyncComponent = items.some((item) => {
      const type = item.type.toLowerCase();
      return type === 'message-queue' || type === 'queue';
    });

    const hasAsyncConnection = connections.some((connection) => {
      const text = connection.label.toLowerCase();
      return /(async|queue|stream|event|publish|subscribe)/.test(text);
    });

    const hasApiExecutionSurface = items.some((item) => {
      const type = item.type.toLowerCase();
      return (
        type === 'api-gateway' ||
        type === 'microservice' ||
        type === 'service' ||
        type === 'backend'
      );
    });

    const hasPersistentStore = items.some((item) => {
      const type = item.type.toLowerCase();
      return type === 'database' || type === 'storage';
    });

    const hasEnrichedItemContext = items.every((item) => {
      const context = this.toRecord(item.context);
      if (!context) {
        return false;
      }

      return (
        typeof context.purpose === 'string' &&
        context.purpose.trim().length > 0 &&
        typeof context.limitations === 'string' &&
        context.limitations.trim().length > 0 &&
        typeof context.alternatives === 'string' &&
        context.alternatives.trim().length > 0 &&
        typeof context.scalingPlan === 'string' &&
        context.scalingPlan.trim().length > 0
      );
    });

    const isContradictedByDesign = (message: string): boolean => {
      const normalized = message.toLowerCase();

      if (
        blueprint.asyncWorkflows.length > 0 &&
        (hasAsyncComponent || hasAsyncConnection) &&
        /(no queue|no message-bus|no queue\/message-bus|no queue\/message bus|include at least one async component)/.test(
          normalized,
        )
      ) {
        return true;
      }

      if (
        blueprint.apis.length > 0 &&
        hasApiExecutionSurface &&
        /(no api execution surface|no api gateway|no service components? that can serve defined endpoints|defines apis.*no api|include api gateway or service components)/.test(
          normalized,
        )
      ) {
        return true;
      }

      if (
        hasPersistentStore &&
        /(core domain persistence strategy|missing persistent data store|lacks explicit persistence|explicitly include persistent stores for core entities)/.test(
          normalized,
        )
      ) {
        return true;
      }

      if (
        hasEnrichedItemContext &&
        /(missing.*purpose.*limitations.*alternatives.*scaling|missing.*context.*components)/.test(
          normalized,
        )
      ) {
        return true;
      }

      return false;
    };

    return {
      ...llmValidation,
      missingRequirements: llmValidation.missingRequirements.filter(
        (message) => !isContradictedByDesign(message),
      ),
      gaps: llmValidation.gaps.filter(
        (message) => !isContradictedByDesign(message),
      ),
    };
  }

  private evaluateDesignSemantics(
    query: string,
    blueprint: ArchitectBlueprint,
    design: Record<string, unknown>,
    contextDossier: ArchitectureContextDossier,
  ): DesignValidationIssueBundle {
    const missingRequirements: string[] = [];
    const gaps: string[] = [];
    const recommendations: string[] = [];

    const items = this.readDesignItems(design);
    const connections = this.readDesignConnections(design);
    const corpus = this.buildDesignSemanticCorpus(items, connections);
    const itemByName = new Map(
      items.map((item) => [item.name.toLowerCase(), item]),
    );

    let penalty = 0;
    let criticalIssueCount = 0;

    const contextIssueItems: string[] = [];
    const requiredContextKeys = [
      'purpose',
      'limitations',
      'alternatives',
      'scalingPlan',
    ];

    for (const item of items) {
      const context = this.toRecord(item.context);
      const hasAllContext = requiredContextKeys.every((key) => {
        const value = context?.[key];
        return typeof value === 'string' && value.trim().length > 0;
      });

      if (!hasAllContext) {
        contextIssueItems.push(item.name);
      }
    }

    if (contextIssueItems.length > 0) {
      missingRequirements.push(
        `Missing enriched item context on ${contextIssueItems.length} components (purpose/limitations/alternatives/scalingPlan).`,
      );
      recommendations.push(
        `Ensure all items provide non-empty context keys: purpose, limitations, alternatives, scalingPlan (examples: ${contextIssueItems.slice(0, 3).join(', ')}).`,
      );
      penalty += Math.min(30, contextIssueItems.length * 4);
      criticalIssueCount += 1;
    }

    if (items.length > 1) {
      const degreeByItem = new Map<string, number>();

      for (const item of items) {
        degreeByItem.set(item.name.toLowerCase(), 0);
      }

      for (const connection of connections) {
        const from = (connection.from || '').toLowerCase();
        const to = (connection.to || '').toLowerCase();

        if (degreeByItem.has(from)) {
          degreeByItem.set(from, (degreeByItem.get(from) || 0) + 1);
        }

        if (degreeByItem.has(to)) {
          degreeByItem.set(to, (degreeByItem.get(to) || 0) + 1);
        }
      }

      const orphanItems = items.filter((item) => {
        const type = item.type.toLowerCase();
        const isLegendLike = type === 'text-box';
        if (isLegendLike) {
          return false;
        }

        const degree = degreeByItem.get(item.name.toLowerCase()) || 0;
        return degree === 0;
      });

      if (orphanItems.length > 0) {
        gaps.push(
          `Detected ${orphanItems.length} disconnected component(s) with no incoming/outgoing connections.`,
        );
        recommendations.push(
          `Connect or remove orphan components (examples: ${orphanItems
            .slice(0, 4)
            .map((item) => item.name)
            .join(', ')}).`,
        );
        penalty += Math.min(16, orphanItems.length * 4);
        criticalIssueCount += 1;
      }
    }

    const cacheToDbReads = connections.filter((conn) => {
      const from = conn.from?.toLowerCase() || '';
      const to = conn.to?.toLowerCase() || '';
      const label = conn.label.toLowerCase();
      const fromType = itemByName.get(from)?.type?.toLowerCase() || '';
      const toType = itemByName.get(to)?.type?.toLowerCase() || '';

      const readLikeLabel = /(read|cache read|lookup)/.test(label);
      return fromType === 'cache' && toType === 'database' && readLikeLabel;
    });

    if (cacheToDbReads.length > 0) {
      gaps.push(
        'Detected cache->database read paths, which usually indicates reversed cache semantics.',
      );
      recommendations.push(
        'Model cache reads as service->cache and service->database fallback (cache miss), not cache->database read flow.',
      );
      penalty += 12;
      criticalIssueCount += 1;
    }

    const databaseToCacheDirect = connections.filter((conn) => {
      const from = conn.from?.toLowerCase() || '';
      const to = conn.to?.toLowerCase() || '';
      const label = conn.label.toLowerCase();
      const fromType = itemByName.get(from)?.type?.toLowerCase() || '';
      const toType = itemByName.get(to)?.type?.toLowerCase() || '';

      const acceptablePattern =
        /(invalidate|invalidation|warm|prewarm|refresh|replication|replicate|cdc|change data capture)/.test(
          label,
        );

      return (
        fromType === 'database' && toType === 'cache' && !acceptablePattern
      );
    });

    if (databaseToCacheDirect.length > 0) {
      gaps.push(
        'Detected direct database->cache data path without explicit invalidation/refresh semantics.',
      );
      recommendations.push(
        'Prefer service-owned cache patterns (service->cache + service->database fallback) and use explicit cache invalidation/warmup labels when database drives cache updates.',
      );
      penalty += 8;
    }

    const serviceLikeTypes = new Set([
      'microservice',
      'service',
      'backend',
      'api-gateway',
      'gateway',
      'lambda',
    ]);
    const hasCacheNode = items.some(
      (item) => item.type.toLowerCase() === 'cache',
    );
    const hasDatabaseNode = items.some(
      (item) => item.type.toLowerCase() === 'database',
    );

    if (hasCacheNode && hasDatabaseNode) {
      const serviceToCacheNames = new Set(
        connections
          .filter((conn) => {
            const fromType =
              itemByName
                .get((conn.from || '').toLowerCase())
                ?.type?.toLowerCase() || '';
            const toType =
              itemByName
                .get((conn.to || '').toLowerCase())
                ?.type?.toLowerCase() || '';
            return serviceLikeTypes.has(fromType) && toType === 'cache';
          })
          .map((conn) => (conn.from || '').toLowerCase())
          .filter((name) => name.length > 0),
      );

      const hasServiceDbFallback = connections.some((conn) => {
        const from = (conn.from || '').toLowerCase();
        const toType =
          itemByName.get((conn.to || '').toLowerCase())?.type?.toLowerCase() ||
          '';
        return serviceToCacheNames.has(from) && toType === 'database';
      });

      if (serviceToCacheNames.size === 0 || !hasServiceDbFallback) {
        gaps.push(
          'Cache layer exists but service->cache->database fallback topology is missing or incomplete.',
        );
        recommendations.push(
          'For read paths, connect at least one service to cache and to database fallback (cache miss), and avoid relying only on direct database->cache links.',
        );
        penalty += 10;
        criticalIssueCount += 1;
      }
    }

    const hasCdn = items.some((item) => item.type.toLowerCase() === 'cdn');
    if (hasCdn) {
      const cdnNames = new Set(
        items
          .filter((item) => item.type.toLowerCase() === 'cdn')
          .map((item) => item.name.toLowerCase()),
      );

      const cdnConnections = connections.filter((conn) => {
        const from = (conn.from || '').toLowerCase();
        const to = (conn.to || '').toLowerCase();
        return cdnNames.has(from) || cdnNames.has(to);
      });

      if (cdnConnections.length === 0) {
        gaps.push(
          'CDN component exists but has no incoming or outgoing connections (orphan CDN node).',
        );
        recommendations.push(
          'Connect CDN to an origin path (for example storage/service -> CDN) and to a delivery path where clients retrieve content.',
        );
        penalty += 10;
        criticalIssueCount += 1;
      }

      const hasOriginToCdn = connections.some((conn) => {
        const from = (conn.from || '').toLowerCase();
        const to = (conn.to || '').toLowerCase();
        if (!cdnNames.has(to)) {
          return false;
        }

        const fromType = itemByName.get(from)?.type?.toLowerCase() || '';
        return (
          fromType === 'storage' ||
          fromType === 'database' ||
          fromType === 'microservice' ||
          fromType === 'service' ||
          fromType === 'backend'
        );
      });

      if (!hasOriginToCdn) {
        gaps.push(
          'CDN is missing an explicit origin feed (no storage/service -> CDN path).',
        );
        recommendations.push(
          'Add an origin connection into CDN (for example image storage or media service -> CDN) to model asset distribution flow.',
        );
        penalty += 6;
      }

      const hasClientFacingNode = items.some((item) => {
        const type = item.type.toLowerCase();
        return (
          type === 'web-app' ||
          type === 'mobile-app' ||
          type === 'user' ||
          type === 'frontend'
        );
      });

      const queryHintsStatic =
        /(static|cdn|content delivery|asset|global distribution)/i.test(query);

      const hasCdnDeliveryPath = connections.some((conn) => {
        const from = (conn.from || '').toLowerCase();
        if (!cdnNames.has(from)) {
          return false;
        }

        const toType =
          itemByName.get((conn.to || '').toLowerCase())?.type?.toLowerCase() ||
          '';
        return (
          toType === 'web-app' ||
          toType === 'mobile-app' ||
          toType === 'user' ||
          toType === 'frontend' ||
          toType === 'api-gateway'
        );
      });

      if (hasClientFacingNode && !hasCdnDeliveryPath) {
        gaps.push(
          'CDN lacks an explicit delivery path to client-facing components.',
        );
        recommendations.push(
          'Connect CDN to client-facing nodes (web/mobile/user/frontend or gateway) to reflect actual content delivery path.',
        );
        penalty += 6;
      }

      if (!hasClientFacingNode && !queryHintsStatic) {
        gaps.push(
          'CDN appears without client-facing/static-content requirements, likely unnecessary for this design.',
        );
        recommendations.push(
          'Add CDN only when client-facing static/content delivery is required or explicitly requested.',
        );
        penalty += 8;
      }
    }

    const loadBalancers = items.filter(
      (item) => item.type.toLowerCase() === 'load-balancer',
    );
    for (const lb of loadBalancers) {
      const downstream = new Set(
        connections
          .filter(
            (conn) => (conn.from || '').toLowerCase() === lb.name.toLowerCase(),
          )
          .map((conn) => (conn.to || '').toLowerCase())
          .filter((value) => value.length > 0),
      );

      if (downstream.size <= 1) {
        gaps.push(
          `Load balancer ${lb.name} routes to ${downstream.size} target(s); traffic distribution value is unclear.`,
        );
        recommendations.push(
          'Use load balancer only with multiple upstream targets/instances or explicit HA/traffic requirements.',
        );
        penalty += 6;
      }
    }

    const asyncRequired = blueprint.asyncWorkflows.length > 0;
    const hasAsyncComponent = items.some((item) => {
      const type = item.type.toLowerCase();
      return type === 'message-queue' || type === 'queue';
    });

    const asyncNodeNames = new Set(
      items
        .filter((item) => {
          const type = item.type.toLowerCase();
          return type === 'message-queue' || type === 'queue';
        })
        .map((item) => item.name.toLowerCase()),
    );

    if (asyncRequired && !hasAsyncComponent) {
      missingRequirements.push(
        'Blueprint requires async workflows but generated design has no queue/message-bus component.',
      );
      recommendations.push(
        'Include at least one async component (message-queue/event-bus) when blueprint includes async workflows.',
      );
      penalty += 10;
      criticalIssueCount += 1;
    }

    if (asyncRequired && asyncNodeNames.size > 0) {
      const hasQueueProducer = connections.some((conn) => {
        const from = (conn.from || '').toLowerCase();
        const to = (conn.to || '').toLowerCase();
        return !asyncNodeNames.has(from) && asyncNodeNames.has(to);
      });

      const hasQueueConsumer = connections.some((conn) => {
        const from = (conn.from || '').toLowerCase();
        const to = (conn.to || '').toLowerCase();
        return asyncNodeNames.has(from) && !asyncNodeNames.has(to);
      });

      if (!hasQueueProducer || !hasQueueConsumer) {
        gaps.push(
          'Async queue/stream exists but does not show both producer->queue and queue->consumer paths.',
        );
        recommendations.push(
          'Model async flow with explicit producer->queue and queue->consumer connections for each required async workflow.',
        );
        penalty += 8;
      }
    }

    const clientFacingTypes = new Set([
      'web-app',
      'mobile-app',
      'user',
      'frontend',
    ]);
    const gatewayTypes = new Set(['api-gateway', 'gateway', 'load-balancer']);

    const reverseClientFlow = connections.filter((conn) => {
      const fromType =
        itemByName.get((conn.from || '').toLowerCase())?.type?.toLowerCase() ||
        '';
      const toType =
        itemByName.get((conn.to || '').toLowerCase())?.type?.toLowerCase() ||
        '';
      const label = conn.label.toLowerCase();

      const responseLike =
        /(response|callback|websocket push|push notification|return)/.test(
          label,
        );

      return (
        gatewayTypes.has(fromType) &&
        clientFacingTypes.has(toType) &&
        !responseLike
      );
    });

    if (reverseClientFlow.length > 0) {
      gaps.push(
        'Detected gateway/load-balancer -> client request flow; request direction is likely inverted.',
      );
      recommendations.push(
        'Model request ingress as client -> load balancer/gateway -> services; reserve reverse edges for explicit response/callback channels.',
      );
      penalty += 10;
      criticalIssueCount += 1;
    }

    const gatewayToLoadBalancerFlow = connections.filter((conn) => {
      const fromType =
        itemByName.get((conn.from || '').toLowerCase())?.type?.toLowerCase() ||
        '';
      const toType =
        itemByName.get((conn.to || '').toLowerCase())?.type?.toLowerCase() ||
        '';
      return fromType === 'api-gateway' && toType === 'load-balancer';
    });

    if (gatewayToLoadBalancerFlow.length > 0) {
      gaps.push(
        'Detected API gateway -> load balancer flow; ingress routing direction is inverted.',
      );
      recommendations.push(
        'Model ingress as client -> load balancer -> API gateway -> services. Avoid routing traffic from gateway back to load balancer.',
      );
      penalty += 16;
      criticalIssueCount += 1;
    }

    const hasLoadBalancer = items.some(
      (item) => item.type.toLowerCase() === 'load-balancer',
    );
    const hasApiGateway = items.some((item) => {
      const type = item.type.toLowerCase();
      return type === 'api-gateway' || type === 'gateway';
    });

    if (hasLoadBalancer && hasApiGateway) {
      const hasLoadBalancerToGatewayFlow = connections.some((conn) => {
        const fromType =
          itemByName
            .get((conn.from || '').toLowerCase())
            ?.type?.toLowerCase() || '';
        const toType =
          itemByName.get((conn.to || '').toLowerCase())?.type?.toLowerCase() ||
          '';
        return (
          fromType === 'load-balancer' &&
          (toType === 'api-gateway' || toType === 'gateway')
        );
      });

      if (!hasLoadBalancerToGatewayFlow) {
        gaps.push(
          'Load balancer and API gateway both exist but no load balancer -> API gateway ingress edge is modeled.',
        );
        recommendations.push(
          'When both components are present, add explicit LB -> API Gateway request routing and keep services behind gateway boundaries.',
        );
        penalty += 10;
        criticalIssueCount += 1;
      }
    }

    const loadBalancerToDatabase = connections.filter((conn) => {
      const fromType =
        itemByName.get((conn.from || '').toLowerCase())?.type?.toLowerCase() ||
        '';
      const toType =
        itemByName.get((conn.to || '').toLowerCase())?.type?.toLowerCase() ||
        '';
      return fromType === 'load-balancer' && toType === 'database';
    });

    if (loadBalancerToDatabase.length > 0) {
      gaps.push(
        'Detected load balancer -> database routing which bypasses API/service boundaries.',
      );
      recommendations.push(
        'Terminate load balancer traffic at gateway/service layers. Databases should be accessed by services, not directly by load balancers.',
      );
      penalty += 8;
      criticalIssueCount += 1;
    }

    const directClientToDatabase = connections.filter((conn) => {
      const fromType =
        itemByName.get((conn.from || '').toLowerCase())?.type?.toLowerCase() ||
        '';
      const toType =
        itemByName.get((conn.to || '').toLowerCase())?.type?.toLowerCase() ||
        '';
      return clientFacingTypes.has(fromType) && toType === 'database';
    });

    if (directClientToDatabase.length > 0) {
      gaps.push(
        'Detected direct client-facing node -> database connections that bypass service/API boundaries.',
      );
      recommendations.push(
        'Route client interactions through API gateway/services and keep databases behind service boundaries.',
      );
      penalty += 8;
      criticalIssueCount += 1;
    }

    const telemetryNodes = items.filter((item) => {
      const type = item.type.toLowerCase();
      const name = item.name.toLowerCase();
      return (
        type === 'monitor' ||
        name.includes('telemetry') ||
        name.includes('observability') ||
        name.includes('monitor')
      );
    });

    if (telemetryNodes.length > 0) {
      const telemetryBackedByStore = telemetryNodes.some((node) => {
        const nodeName = node.name.toLowerCase();
        return connections.some((conn) => {
          const from = (conn.from || '').toLowerCase();
          if (from !== nodeName) {
            return false;
          }

          const toType =
            itemByName
              .get((conn.to || '').toLowerCase())
              ?.type?.toLowerCase() || '';
          return toType === 'database' || toType === 'storage';
        });
      });

      if (!telemetryBackedByStore) {
        missingRequirements.push(
          'Telemetry/observability components are present but missing explicit persistence path (metrics/log store).',
        );
        recommendations.push(
          'Connect telemetry/monitoring components to a durable telemetry store (time-series DB/log storage/object storage).',
        );
        penalty += 8;
      }
    }

    const hasPersistentStore = items.some((item) => {
      const type = item.type.toLowerCase();
      return type === 'database' || type === 'storage';
    });
    const hasPersistentStoreHint =
      /(postgres|mysql|cassandra|dynamo|mongodb|mongo|sql|nosql|object storage|s3|blob|warehouse)/.test(
        corpus,
      );

    if (!hasPersistentStore && !hasPersistentStoreHint) {
      missingRequirements.push(
        'Missing persistent data store design (database or object storage) for core domain state.',
      );
      recommendations.push(
        'Include at least one persistent store (e.g., relational/NoSQL DB and/or object storage) for domain durability.',
      );
      penalty += 12;
      criticalIssueCount += 1;
    }

    const serviceTypes = new Set([
      'microservice',
      'service',
      'backend',
      'api-gateway',
    ]);
    const entitySignals = new Set(
      blueprint.entities
        .map((entity) => this.extractMeaningfulRequirementTokens(entity.name))
        .flat()
        .filter((token) => token.length > 2),
    );

    const statefulServiceCandidates = items.filter((item) => {
      const type = item.type.toLowerCase();
      if (!serviceTypes.has(type)) {
        return false;
      }

      const context = this.toRecord(item.context);
      const contextText = context
        ? Object.values(context)
            .filter((value): value is string => typeof value === 'string')
            .join(' ')
            .toLowerCase()
        : '';
      const composite = `${item.name.toLowerCase()} ${contextText}`;

      return Array.from(entitySignals).some((signal) =>
        composite.includes(signal),
      );
    });

    const servicesWithoutPersistence = statefulServiceCandidates.filter(
      (service) => {
        const serviceName = service.name.toLowerCase();
        return !connections.some((conn) => {
          const from = (conn.from || '').toLowerCase();
          if (from !== serviceName) {
            return false;
          }

          const toType =
            itemByName
              .get((conn.to || '').toLowerCase())
              ?.type?.toLowerCase() || '';
          return toType === 'database' || toType === 'storage';
        });
      },
    );

    if (servicesWithoutPersistence.length > 0) {
      missingRequirements.push(
        `Stateful services missing persistence connection(s): ${servicesWithoutPersistence
          .slice(0, 5)
          .map((item) => item.name)
          .join(', ')}.`,
      );
      recommendations.push(
        'Connect each state-owning service (for example Post/Follow/Comment/Like-like services) to an explicit persistent store (database/storage) for durable state.',
      );
      penalty += Math.min(18, servicesWithoutPersistence.length * 6);
      criticalIssueCount += 1;
    }

    const queryAwareCoverage = this.evaluateQuerySpecificCoverage(
      query,
      blueprint,
      corpus,
      items,
      connections,
      contextDossier,
    );
    missingRequirements.push(...queryAwareCoverage.missingRequirements);
    gaps.push(...queryAwareCoverage.gaps);
    recommendations.push(...queryAwareCoverage.recommendations);
    penalty += queryAwareCoverage.penalty;
    criticalIssueCount += queryAwareCoverage.criticalIssueCount;

    return {
      missingRequirements,
      gaps,
      recommendations,
      penalty,
      criticalIssueCount,
    };
  }

  private buildDesignSemanticCorpus(
    items: Array<{ name: string; type: string; context?: unknown }>,
    connections: Array<{ from?: string; to?: string; label: string }>,
  ): string {
    const itemText = items
      .map((item) => {
        const context = this.toRecord(item.context);
        const contextText = context
          ? Object.values(context)
              .filter((value): value is string => typeof value === 'string')
              .join(' ')
          : '';
        return `${item.name} ${item.type} ${contextText}`;
      })
      .join(' ');

    const connectionText = connections
      .map((connection) =>
        `${connection.from || ''} ${connection.label} ${connection.to || ''}`.trim(),
      )
      .join(' ');

    return `${itemText} ${connectionText}`.toLowerCase();
  }

  private evaluateQuerySpecificCoverage(
    query: string,
    blueprint: ArchitectBlueprint,
    corpus: string,
    items: Array<{ name: string; type: string; context?: unknown }>,
    connections: Array<{ from?: string; to?: string; label: string }>,
    contextDossier: ArchitectureContextDossier,
  ): DesignValidationIssueBundle {
    const missingRequirements: string[] = [];
    const gaps: string[] = [];
    const recommendations: string[] = [];

    let penalty = 0;
    let criticalIssueCount = 0;

    const queryLower = query.toLowerCase();
    const hasQueryHint = (pattern: RegExp): boolean => pattern.test(queryLower);
    const hasInCorpus = (pattern: RegExp): boolean => pattern.test(corpus);

    for (const expectation of contextDossier.expectations) {
      const hasEvidence = expectation.evidencePatterns.some((pattern) =>
        corpus.includes(pattern.toLowerCase()),
      );

      if (!hasEvidence) {
        if (expectation.critical) {
          missingRequirements.push(
            `Missing context-derived requirement: ${expectation.requirement}`,
          );
          penalty += 10;
          criticalIssueCount += 1;
        } else {
          gaps.push(
            `Weak coverage for context-derived requirement: ${expectation.requirement}`,
          );
          penalty += 5;
        }

        recommendations.push(expectation.recommendation);
      }
    }

    const functionalCoverage = this.evaluateFunctionalRequirementCoverage(
      blueprint,
      items,
      connections,
      corpus,
    );
    missingRequirements.push(...functionalCoverage.missingRequirements);
    gaps.push(...functionalCoverage.gaps);
    recommendations.push(...functionalCoverage.recommendations);
    penalty += functionalCoverage.penalty;
    criticalIssueCount += functionalCoverage.criticalIssueCount;

    if (
      hasQueryHint(
        /(unique short|short id|short code|collision|base62|id generation)/,
      )
    ) {
      const hasConcreteKeyStrategy = hasInCorpus(
        /(base62|snowflake|ksuid|nanoid|counter|sequence|id generator|key generation|unique index|retry on collision|collision retry)/,
      );

      if (!hasConcreteKeyStrategy) {
        missingRequirements.push(
          'Missing concrete short-ID generation and collision-avoidance mechanism despite explicit query requirement.',
        );
        recommendations.push(
          'Add explicit ID strategy (for example Base62 plus monotonic ID or KGS) and collision handling (unique index plus retry).',
        );
        penalty += 10;
        criticalIssueCount += 1;
      }
    }

    if (hasQueryHint(/(phishing|spam|malicious|abuse)/)) {
      const hasSafetyControls = hasInCorpus(
        /(malicious|phishing|spam|safe browsing|url reputation|blocklist|allowlist|moderation)/,
      );

      if (!hasSafetyControls) {
        missingRequirements.push(
          'Missing malicious-link or anti-spam controls requested by the query.',
        );
        recommendations.push(
          'Add URL safety scanning or reputation checks and policy enforcement for phishing or spam prevention.',
        );
        penalty += 8;
      }
    }

    if (hasQueryHint(/(rate.?limit|throttle|abusive clients)/)) {
      const hasRateLimiting = hasInCorpus(
        /(rate limit|throttle|token bucket|leaky bucket|quota)/,
      );

      if (!hasRateLimiting) {
        missingRequirements.push(
          'Missing rate-limiting strategy requested for abusive clients.',
        );
        recommendations.push(
          'Include an explicit rate limiter (gateway policy or dedicated service) and mention algorithm or thresholds.',
        );
        penalty += 8;
      }
    }

    if (hasQueryHint(/(expiration|expiry|delete|deletion|ttl)/)) {
      const hasLifecycleControl = hasInCorpus(
        /(ttl|expiration|expiry|cleanup|retention|deletion|delete worker|cron|scheduler)/,
      );

      if (!hasLifecycleControl) {
        missingRequirements.push(
          'Missing expiration/deletion lifecycle handling explicitly requested by the query.',
        );
        recommendations.push(
          'Add TTL or expiration metadata and a cleanup worker or scheduled deletion flow.',
        );
        penalty += 10;
        criticalIssueCount += 1;
      }
    }

    if (hasQueryHint(/(analytics|logs|log|tracking)/)) {
      const hasAnalyticsPipeline = hasInCorpus(
        /(analytics|log|event stream|queue|pipeline|warehouse|batch)/,
      );

      if (!hasAnalyticsPipeline) {
        gaps.push(
          'Missing analytics or logging pipeline despite explicit analytics requirement.',
        );
        recommendations.push(
          'Add asynchronous analytics ingestion (queue or stream plus consumers and analytics storage).',
        );
        penalty += 6;
      }
    }

    if (
      hasQueryHint(/(cache|redis|hot key|hot keys|popular links|very popular)/)
    ) {
      const hasCacheNode = items.some(
        (item) => item.type.toLowerCase() === 'cache',
      );
      const hasCacheFlow = hasInCorpus(
        /(cache-aside|write-through|cache lookup|cache hit|redis)/,
      );
      const hasHotKeyStrategy = hasInCorpus(
        /(hot key|shard|replica|partition|request coalescing|singleflight|popular links)/,
      );

      if (!hasCacheNode || !hasCacheFlow) {
        missingRequirements.push(
          'Missing explicit cache read path for frequently accessed short URLs.',
        );
        recommendations.push(
          'Include a cache component and connect redirect or read service to cache with a named strategy (for example Cache-Aside).',
        );
        penalty += 10;
        criticalIssueCount += 1;
      }

      if (!hasHotKeyStrategy) {
        gaps.push(
          'Hot-key mitigation strategy is not explicit even though popular-link traffic was requested.',
        );
        recommendations.push(
          'Add hot-key strategy such as key sharding, replication, request coalescing, or edge caching for redirects.',
        );
        penalty += 6;
      }
    }

    return {
      missingRequirements,
      gaps,
      recommendations,
      penalty,
      criticalIssueCount,
    };
  }

  private evaluateFunctionalRequirementCoverage(
    blueprint: ArchitectBlueprint,
    items: Array<{ name: string; type: string; context?: unknown }>,
    connections: Array<{ from?: string; to?: string; label: string }>,
    corpus: string,
  ): DesignValidationIssueBundle {
    const missingRequirements: string[] = [];
    const gaps: string[] = [];
    const recommendations: string[] = [];

    let penalty = 0;
    let criticalIssueCount = 0;

    const itemCorpus = items
      .map((item) => {
        const context = this.toRecord(item.context);
        const contextText = context
          ? Object.values(context)
              .filter((value): value is string => typeof value === 'string')
              .join(' ')
          : '';
        return `${item.name} ${item.type} ${contextText}`;
      })
      .join(' ')
      .toLowerCase();

    const connectionCorpus = connections
      .map((connection) =>
        `${connection.from || ''} ${connection.label} ${connection.to || ''}`.trim(),
      )
      .join(' ')
      .toLowerCase();

    for (const requirement of blueprint.functionalRequirements) {
      const tokens = this.extractMeaningfulRequirementTokens(requirement);
      if (tokens.length === 0) {
        continue;
      }

      const componentHits = tokens.filter((token) =>
        itemCorpus.includes(token),
      );
      const flowHits = tokens.filter((token) =>
        connectionCorpus.includes(token),
      );

      if (componentHits.length === 0) {
        missingRequirements.push(
          `Functional requirement is not represented by components: "${requirement}".`,
        );
        recommendations.push(
          `Add or rename components so requirement intent is explicit: "${requirement}".`,
        );
        penalty += 8;
        criticalIssueCount += 1;
        continue;
      }

      if (flowHits.length === 0) {
        gaps.push(
          `Functional requirement lacks explicit interaction flow: "${requirement}".`,
        );
        recommendations.push(
          `Add connections/APIs/events that operationalize this requirement: "${requirement}".`,
        );
        penalty += 4;
      }
    }

    if (blueprint.apis.length > 0) {
      const hasApiExecutionSurface = items.some((item) => {
        const type = item.type.toLowerCase();
        return (
          type === 'api-gateway' ||
          type === 'microservice' ||
          type === 'service' ||
          type === 'backend'
        );
      });

      if (!hasApiExecutionSurface) {
        missingRequirements.push(
          'Blueprint defines APIs, but generated design has no API execution surface (gateway/service/backend).',
        );
        recommendations.push(
          'Include API gateway or service components that can serve defined endpoints.',
        );
        penalty += 10;
        criticalIssueCount += 1;
      }

      const hasExplicitApiEntrypoint = items.some((item) => {
        const type = item.type.toLowerCase();
        return type === 'api-gateway' || type === 'gateway';
      });

      if (!hasExplicitApiEntrypoint) {
        missingRequirements.push(
          'Blueprint defines APIs, but generated design is missing an explicit API entrypoint component (api-gateway/gateway).',
        );
        recommendations.push(
          'Add an API Gateway (or gateway) as the client/API entrypoint and route endpoint traffic through it.',
        );
        penalty += 8;
        criticalIssueCount += 1;
      }

      const apiTrafficHighScaleSignals = new RegExp(
        'million|millions|concurrent|high availability|fault tolerance|99\\.9|99\\.99|uptime|traffic spike|burst|global',
        'i',
      ).test(
        [
          ...blueprint.nonFunctionalRequirements,
          ...blueprint.scalabilityDecisions,
        ].join(' '),
      );

      const gatewayCount = items.filter((item) => {
        const type = item.type.toLowerCase();
        return type === 'api-gateway' || type === 'gateway';
      }).length;
      const hasLoadBalancer = items.some(
        (item) => item.type.toLowerCase() === 'load-balancer',
      );

      if (
        apiTrafficHighScaleSignals &&
        gatewayCount === 1 &&
        !hasLoadBalancer
      ) {
        gaps.push(
          'High-scale API requirements detected, but only a single gateway is present without a load balancer or equivalent traffic distribution layer.',
        );
        recommendations.push(
          'For high-concurrency API traffic, model gateway HA explicitly (load balancer in front of multiple gateway instances or equivalent managed ingress).',
        );
        penalty += 5;
      }
    }

    const actorText = blueprint.actors.join(' ').toLowerCase();
    const requiresClientFacingEntry =
      /(user|users|client|clients|admin|moderator|consumer|viewer|mobile|web)/.test(
        actorText,
      );

    if (requiresClientFacingEntry) {
      const hasClientFacingNode = items.some((item) => {
        const type = item.type.toLowerCase();
        return (
          type === 'user' ||
          type === 'web-app' ||
          type === 'mobile-app' ||
          type === 'frontend'
        );
      });

      if (!hasClientFacingNode) {
        missingRequirements.push(
          'Blueprint actors imply client/user entry, but generated design has no client-facing node (user/web-app/mobile-app/frontend).',
        );
        recommendations.push(
          'Add at least one client-facing node (for example User, Web App, or Mobile App) and connect it to the API entrypoint.',
        );
        penalty += 7;
        criticalIssueCount += 1;
      }
    }

    if (blueprint.entities.length > 0) {
      const hasPersistence =
        /(database|storage|postgres|mysql|cassandra|dynamo|mongodb|warehouse|object storage|s3|blob)/.test(
          corpus,
        );

      if (!hasPersistence) {
        missingRequirements.push(
          'Blueprint includes entities, but generated design lacks explicit persistence components for them.',
        );
        recommendations.push(
          'Add persistent storage components and map entities to stores (read/write responsibility).',
        );
        penalty += 10;
        criticalIssueCount += 1;
      }
    }

    return {
      missingRequirements,
      gaps,
      recommendations,
      penalty,
      criticalIssueCount,
    };
  }

  private extractMeaningfulRequirementTokens(requirement: string): string[] {
    const stopWords = new Set([
      'the',
      'and',
      'for',
      'with',
      'from',
      'into',
      'that',
      'this',
      'these',
      'those',
      'allow',
      'allows',
      'enable',
      'enables',
      'support',
      'supports',
      'implement',
      'implements',
      'provide',
      'provides',
      'using',
      'based',
      'through',
      'across',
      'between',
      'under',
      'over',
      'more',
      'most',
      'least',
      'high',
      'low',
      'user',
      'users',
      'system',
      'service',
      'services',
      'data',
      'required',
      'requirement',
    ]);

    return Array.from(
      new Set(
        requirement
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .map((token) => token.trim())
          .filter(
            (token) =>
              token.length > 2 && !stopWords.has(token) && !/^\d+$/.test(token),
          )
          .slice(0, 8),
      ),
    );
  }

  private buildContextDossier(
    query: string,
    ragContext: string,
  ): ArchitectureContextDossier {
    const text = `${query}\n${ragContext}`.toLowerCase();
    const explicitQuestions = this.extractExplicitQuestions(query);

    const domainSignals = new Set<string>();
    const mustHaveCapabilities = new Set<string>();
    const riskHotspots = new Set<string>();
    const expectations: ContextMechanismExpectation[] = [];

    const registerExpectation = (
      expectation: ContextMechanismExpectation,
    ): void => {
      if (
        expectations.some(
          (existing) => existing.requirement === expectation.requirement,
        )
      ) {
        return;
      }

      expectations.push(expectation);
      mustHaveCapabilities.add(expectation.requirement);
    };

    const addSignal = (
      pattern: RegExp,
      signal: string,
      risks: string[],
      signalExpectations: ContextMechanismExpectation[],
    ): void => {
      if (!pattern.test(text)) {
        return;
      }

      domainSignals.add(signal);
      risks.forEach((risk) => riskHotspots.add(risk));
      signalExpectations.forEach((expectation) => {
        registerExpectation(expectation);
      });
    };

    addSignal(
      /(url short|shortener|short id|short code|redirect)/,
      'URL shortener domain',
      ['ID collisions under high write throughput', 'hot-key read spikes'],
      [
        {
          requirement:
            'Deterministic short-ID generation and collision handling',
          evidencePatterns: [
            'base62',
            'short id',
            'unique index',
            'collision retry',
            'id generator',
          ],
          recommendation:
            'Describe explicit short-ID generation and collision strategy (e.g., Base62 + unique index + retry).',
          critical: true,
        },
      ],
    );

    addSignal(
      /(scheduler|cron|job|task orchestration|workflow engine|delayed job)/,
      'Scheduling and orchestration domain',
      [
        'duplicate execution from multiple schedulers',
        'clock skew and timezone drift',
        'retry storms without idempotency',
      ],
      [
        {
          requirement:
            'Persistent scheduler state with distributed coordination',
          evidencePatterns: [
            'job store',
            'lease',
            'leader election',
            'distributed lock',
            'scheduler coordinator',
          ],
          recommendation:
            'Add scheduler coordinator with persistent job store and leader-election/lease strategy to avoid duplicate firing.',
          critical: true,
        },
        {
          requirement: 'Retry and dead-letter handling for failed jobs',
          evidencePatterns: [
            'retry',
            'backoff',
            'dead letter',
            'dlq',
            'poison message',
          ],
          recommendation:
            'Model retry policy (with backoff and max attempts) and DLQ/failed-job triage flow.',
          critical: true,
        },
        {
          requirement: 'Idempotent execution safeguards',
          evidencePatterns: [
            'idempotency',
            'dedup',
            'execution key',
            'exactly-once',
            'at-least-once',
          ],
          recommendation:
            'Include idempotency keys or dedup state so retries or failovers do not execute side effects twice.',
          critical: true,
        },
      ],
    );

    addSignal(
      /(queue|stream|kafka|rabbitmq|sqs|event|asynchronous|worker)/,
      'Asynchronous processing',
      ['backpressure and lag buildup'],
      [
        {
          requirement:
            'Asynchronous processing path with queue/stream and workers',
          evidencePatterns: [
            'queue',
            'stream',
            'worker',
            'consumer',
            'publish',
          ],
          recommendation:
            'Represent async pipeline explicitly with producer, queue/stream, and worker consumers.',
          critical: true,
        },
      ],
    );

    addSignal(
      /(cache|redis|latency|hot key|throughput|p99|read-heavy)/,
      'Low-latency read path',
      ['cache stampede and stale reads'],
      [
        {
          requirement: 'Explicit cache strategy for read path',
          evidencePatterns: [
            'cache-aside',
            'cache hit',
            'cache miss',
            'redis',
            'coalescing',
          ],
          recommendation:
            'Specify cache strategy for reads (cache-aside/read-through), cache miss fallback, and hot-key mitigation.',
          critical: false,
        },
      ],
    );

    addSignal(
      /(rate.?limit|throttle|abuse|dos|spam)/,
      'Traffic abuse protection',
      ['resource exhaustion from abusive clients'],
      [
        {
          requirement: 'Rate-limiting and abuse controls',
          evidencePatterns: [
            'rate limit',
            'token bucket',
            'leaky bucket',
            'quota',
            'throttle',
          ],
          recommendation:
            'Include explicit rate limiting policy with algorithm choice and enforcement point.',
          critical: true,
        },
      ],
    );

    addSignal(
      /(expiry|expiration|ttl|retention|delete|cleanup|archive)/,
      'Data lifecycle management',
      ['unbounded growth and stale data'],
      [
        {
          requirement: 'TTL/retention and cleanup workflow',
          evidencePatterns: [
            'ttl',
            'expiration',
            'retention',
            'cleanup worker',
            'scheduled deletion',
          ],
          recommendation:
            'Add lifecycle management: TTL/retention metadata and cleanup or archival workers.',
          critical: true,
        },
      ],
    );

    addSignal(
      /(analytics|observability|monitoring|logs|trace|audit)/,
      'Observability and analytics',
      ['blind spots during incidents'],
      [
        {
          requirement: 'Telemetry and analytics pipeline',
          evidencePatterns: [
            'metrics',
            'logs',
            'trace',
            'analytics',
            'dashboard',
          ],
          recommendation:
            'Include telemetry ingestion, storage, and dashboards/alerts for operational visibility.',
          critical: false,
        },
      ],
    );

    registerExpectation({
      requirement: 'Core domain persistence strategy',
      evidencePatterns: [
        'database',
        'postgres',
        'mysql',
        'cassandra',
        'dynamodb',
        'mongodb',
        'storage',
        'object storage',
      ],
      recommendation:
        'Explicitly include persistent stores for core entities and explain why each store matches the workload.',
      critical: true,
    });

    const ragInsights = ragContext
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('RAG_'))
      .map((line) => line.slice(0, 180))
      .slice(0, 3);

    if (explicitQuestions.length > 0) {
      explicitQuestions.forEach((question) => {
        mustHaveCapabilities.add(
          `Explicitly answer: ${question.replace(/\s+/g, ' ').trim()}`,
        );
      });
    }

    if (expectations.length === 0) {
      registerExpectation({
        requirement: 'Concrete data model and API coverage for core flows',
        evidencePatterns: ['api', 'request', 'response', 'entity', 'database'],
        recommendation:
          'Ensure core user flows are mapped to APIs, entities, and persistence choices with scaling notes.',
        critical: true,
      });
      domainSignals.add('General distributed system');
    }

    return {
      explicitQuestions,
      domainSignals: Array.from(domainSignals),
      mustHaveCapabilities: Array.from(mustHaveCapabilities),
      riskHotspots: Array.from(riskHotspots),
      ragInsights,
      expectations,
    };
  }

  private extractExplicitQuestions(query: string): string[] {
    const inlineQuestions = query.includes('?')
      ? query
          .split('?')
          .map((segment) => segment.trim())
          .filter((segment) => segment.length > 0)
          .map((segment) => `${segment}?`)
      : [];

    const imperativeQuestionLines = query
      .split('\n')
      .map((line) => line.trim())
      .filter((line) =>
        /^(how|what|why|which|where|can|should|would|do we|does it)/i.test(
          line,
        ),
      );

    return Array.from(new Set([...inlineQuestions, ...imperativeQuestionLines]))
      .map((question) => question.replace(/\s+/g, ' ').trim())
      .filter((question) => question.length > 0)
      .slice(0, 8);
  }

  private formatContextChecklist(
    contextDossier: ArchitectureContextDossier,
  ): string {
    const lines: string[] = ['Context dossier checklist:'];

    if (contextDossier.explicitQuestions.length > 0) {
      lines.push(
        `- Explicit questions:\n  - ${contextDossier.explicitQuestions.join('\n  - ')}`,
      );
    }

    if (contextDossier.domainSignals.length > 0) {
      lines.push(
        `- Domain signals: ${contextDossier.domainSignals.join(', ')}`,
      );
    }

    if (contextDossier.mustHaveCapabilities.length > 0) {
      lines.push(
        `- Must-have capabilities:\n  - ${contextDossier.mustHaveCapabilities.join('\n  - ')}`,
      );
    }

    if (contextDossier.riskHotspots.length > 0) {
      lines.push(
        `- Risk hotspots:\n  - ${contextDossier.riskHotspots.join('\n  - ')}`,
      );
    }

    if (contextDossier.ragInsights.length > 0) {
      lines.push(
        `- RAG insights:\n  - ${contextDossier.ragInsights.join('\n  - ')}`,
      );
    }

    return lines.join('\n');
  }

  private readDesignItems(
    design: Record<string, unknown>,
  ): Array<{ name: string; type: string; context?: unknown }> {
    const itemsRaw = design.items;
    if (!Array.isArray(itemsRaw)) {
      return [];
    }

    return itemsRaw
      .map((item) => this.toRecord(item))
      .filter((item): item is Record<string, unknown> => !!item)
      .map((item) => ({
        name: typeof item.name === 'string' ? item.name : 'Unknown Item',
        type: typeof item.type === 'string' ? item.type : 'other',
        context: item.context,
      }));
  }

  private readDesignConnections(
    design: Record<string, unknown>,
  ): Array<{ from?: string; to?: string; label: string }> {
    const connectionsRaw = design.connections;
    if (!Array.isArray(connectionsRaw)) {
      return [];
    }

    return connectionsRaw
      .map((conn) => this.toRecord(conn))
      .filter((conn): conn is Record<string, unknown> => !!conn)
      .map((conn) => {
        const fromObj = this.toRecord(conn.from);
        const toObj = this.toRecord(conn.to);
        const from =
          typeof fromObj?.name === 'string'
            ? fromObj.name
            : typeof conn.from === 'string'
              ? conn.from
              : undefined;
        const to =
          typeof toObj?.name === 'string'
            ? toObj.name
            : typeof conn.to === 'string'
              ? conn.to
              : undefined;

        return {
          from,
          to,
          label:
            typeof conn.name === 'string'
              ? conn.name
              : typeof conn.label === 'string'
                ? conn.label
                : '',
        };
      });
  }

  private toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  }

  private async invokeJsonPrompt<T>(prompt: string, fallback: T): Promise<T> {
    try {
      const output = await this.llm.invoke(prompt);
      const content = this.extractContent(output);
      const parsed = this.parseJsonBlock<T>(content);
      return parsed ?? fallback;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Structured prompt failed, using fallback: ${message}`);
      return fallback;
    }
  }

  private extractContent(output: unknown): string {
    if (typeof output === 'string') {
      return output;
    }

    if (output && typeof output === 'object' && 'content' in output) {
      const content = (output as { content: unknown }).content;
      if (typeof content === 'string') {
        return content;
      }

      if (Array.isArray(content)) {
        return content
          .map((part) =>
            typeof part === 'string' ? part : JSON.stringify(part, null, 2),
          )
          .join('\n');
      }
    }

    return JSON.stringify(output);
  }

  private parseJsonBlock<T>(content: string): T | null {
    const cleaned = content.trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      const fenced = cleaned.match(/```json\s*([\s\S]*?)```/i);
      if (fenced && fenced[1]) {
        try {
          return JSON.parse(fenced[1].trim()) as T;
        } catch {
          return null;
        }
      }

      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        try {
          return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as T;
        } catch {
          return null;
        }
      }

      return null;
    }
  }

  private normalizePositiveInt(
    value: number | undefined,
    fallback: number,
  ): number {
    if (!Number.isFinite(value) || value === undefined) {
      return fallback;
    }

    const intValue = Math.floor(value);
    if (intValue < 1) {
      return fallback;
    }

    return intValue;
  }

  private normalizeScoreThreshold(
    value: number | undefined,
    fallback: number,
  ): number {
    if (!Number.isFinite(value) || value === undefined) {
      return fallback;
    }

    if (value < 0) {
      return 0;
    }

    if (value > 100) {
      return 100;
    }

    return Math.floor(value);
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

        // Check if this is a design mutation tool call
        if (
          action &&
          (action.tool === 'create_system_design' ||
            action.tool === 'update_system_design') &&
          observation
        ) {
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

  private extractToolReplaySteps(
    intermediateSteps: unknown[],
  ): AgentToolReplayStep[] {
    const replaySteps: AgentToolReplayStep[] = [];

    for (const step of intermediateSteps) {
      const stepObj = step as Record<string, unknown>;
      const action = stepObj.action as Record<string, unknown> | undefined;

      if (!action || typeof action.tool !== 'string') {
        continue;
      }

      const toolInputRaw = action.toolInput;
      const toolInput =
        toolInputRaw && typeof toolInputRaw === 'object'
          ? (toolInputRaw as Record<string, unknown>)
          : {};

      replaySteps.push({
        tool: action.tool,
        toolInput,
        observation: stepObj.observation,
      });
    }

    return replaySteps;
  }

  private extractLatestMutationToolInput(
    intermediateSteps: unknown[],
  ): Record<string, unknown> | null {
    for (let index = intermediateSteps.length - 1; index >= 0; index -= 1) {
      const stepObj = intermediateSteps[index] as Record<string, unknown>;
      const action = stepObj.action as Record<string, unknown> | undefined;
      if (!action || typeof action.tool !== 'string') {
        continue;
      }

      if (
        action.tool !== 'create_system_design' &&
        action.tool !== 'update_system_design'
      ) {
        continue;
      }

      const toolInput = action.toolInput;
      return toolInput && typeof toolInput === 'object'
        ? (toolInput as Record<string, unknown>)
        : null;
    }

    return null;
  }

  private hydrateDesignFromMutationInput(
    design: Record<string, unknown>,
    mutationInput: Record<string, unknown> | null,
  ): Record<string, unknown> {
    if (!mutationInput) {
      return design;
    }

    const designItemsRaw: unknown[] = Array.isArray(design.items)
      ? (design.items as unknown[])
      : [];
    const mutationItemsRaw: unknown[] = Array.isArray(mutationInput.items)
      ? (mutationInput.items as unknown[])
      : [];

    const mutationItemContextByName = new Map<string, unknown>();
    for (const item of mutationItemsRaw) {
      const record = this.toRecord(item);
      const name =
        typeof record?.name === 'string' ? record.name.toLowerCase() : '';
      if (!name) {
        continue;
      }

      mutationItemContextByName.set(name, record?.context);
    }

    const hydratedItems = designItemsRaw.map((item) => {
      const record = this.toRecord(item);
      if (!record) {
        return item;
      }

      const name =
        typeof record.name === 'string' ? record.name.toLowerCase() : '';
      const mutationContext = name
        ? mutationItemContextByName.get(name)
        : undefined;

      if (
        record.context &&
        typeof record.context === 'object' &&
        !Array.isArray(record.context)
      ) {
        return record;
      }

      if (!mutationContext) {
        return record;
      }

      return {
        ...record,
        context: mutationContext,
      };
    });

    const designConnectionsRaw: unknown[] = Array.isArray(design.connections)
      ? (design.connections as unknown[])
      : [];
    const mutationConnectionsRaw: unknown[] = Array.isArray(
      mutationInput.connections,
    )
      ? (mutationInput.connections as unknown[])
      : [];

    const mutationConnectionContextByKey = new Map<string, unknown>();
    for (const connection of mutationConnectionsRaw) {
      const record = this.toRecord(connection);
      if (!record) {
        continue;
      }

      const from =
        typeof record.from === 'string' ? record.from.toLowerCase() : '';
      const to = typeof record.to === 'string' ? record.to.toLowerCase() : '';
      const label =
        typeof record.label === 'string' ? record.label.toLowerCase() : '';
      const key = `${from}|${to}|${label}`;
      mutationConnectionContextByKey.set(key, record.context);
    }

    const hydratedConnections = designConnectionsRaw.map((connection) => {
      const record = this.toRecord(connection);
      if (!record) {
        return connection;
      }

      const fromObj = this.toRecord(record.from);
      const toObj = this.toRecord(record.to);
      const from =
        typeof fromObj?.name === 'string' ? fromObj.name.toLowerCase() : '';
      const to =
        typeof toObj?.name === 'string' ? toObj.name.toLowerCase() : '';
      const label =
        typeof record.name === 'string'
          ? record.name.toLowerCase()
          : typeof record.label === 'string'
            ? record.label.toLowerCase()
            : '';
      const key = `${from}|${to}|${label}`;
      const mutationContext = mutationConnectionContextByKey.get(key);

      if (
        record.context &&
        typeof record.context === 'object' &&
        !Array.isArray(record.context)
      ) {
        return record;
      }

      if (!mutationContext) {
        return record;
      }

      return {
        ...record,
        context: mutationContext,
      };
    });

    const validationItems =
      mutationItemsRaw.length > 0 ? mutationItemsRaw : hydratedItems;
    const validationConnections =
      mutationConnectionsRaw.length > 0
        ? mutationConnectionsRaw
        : hydratedConnections;

    return {
      ...design,
      items: validationItems,
      connections: validationConnections,
    };
  }

  private async promoteBestAttemptDesign(
    accessToken: string,
    traceRunId: string,
    bestAttempt: MultiAgentAttempt,
  ): Promise<void> {
    const updatePayload = this.buildReplayUpdatePayload(bestAttempt);
    if (!updatePayload) {
      this.traceService.appendStage(
        traceRunId,
        'best_attempt_promotion_skipped',
        {
          reason: 'best_attempt_missing_mutation_payload',
          attempt: bestAttempt.attempt,
        },
      );
      return;
    }

    const updateTool =
      this.designToolsService.getUpdateSystemDesignTool(accessToken);
    const rawResult: unknown = await updateTool.invoke(updatePayload);
    const textResult =
      typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);
    const parsedResult =
      this.parseJsonBlock<Record<string, unknown>>(textResult);

    const success = parsedResult?.success === true;
    if (!success) {
      throw new Error(
        `Failed to promote best attempt payload for design ${bestAttempt.designId}.`,
      );
    }

    const itemCount = Array.isArray(updatePayload.items)
      ? updatePayload.items.length
      : 0;
    const connectionCount = Array.isArray(updatePayload.connections)
      ? updatePayload.connections.length
      : 0;

    this.traceService.appendStage(traceRunId, 'best_attempt_promoted', {
      attempt: bestAttempt.attempt,
      designId: bestAttempt.designId,
      items: itemCount,
      connections: connectionCount,
      score: bestAttempt.validation.score,
    });
  }

  private buildReplayUpdatePayload(
    attempt: MultiAgentAttempt,
  ): Record<string, unknown> | null {
    const source = attempt.mutationInput;
    if (!source) {
      return null;
    }

    const items = Array.isArray(source.items) ? source.items : [];
    if (items.length === 0) {
      return null;
    }

    const payload: Record<string, unknown> = {
      designId: attempt.designId,
      name:
        typeof source.name === 'string' && source.name.trim().length > 0
          ? source.name
          : 'Generated Design',
      items,
      connections: Array.isArray(source.connections) ? source.connections : [],
    };

    if (
      typeof source.description === 'string' &&
      source.description.trim().length > 0
    ) {
      payload.description = source.description;
    }

    if (Array.isArray(source.designGroups)) {
      payload.designGroups = source.designGroups;
    }

    return payload;
  }

  private isBetterAttempt(
    candidate: MultiAgentAttempt,
    incumbent: MultiAgentAttempt,
  ): boolean {
    if (candidate.validation.passed !== incumbent.validation.passed) {
      return candidate.validation.passed;
    }

    const candidateHardViolationCount = this.countHardSemanticViolations(
      candidate.validation,
    );
    const incumbentHardViolationCount = this.countHardSemanticViolations(
      incumbent.validation,
    );

    if (candidateHardViolationCount !== incumbentHardViolationCount) {
      return candidateHardViolationCount < incumbentHardViolationCount;
    }

    const candidateIssueCount =
      candidate.validation.missingRequirements.length +
      candidate.validation.gaps.length;
    const incumbentIssueCount =
      incumbent.validation.missingRequirements.length +
      incumbent.validation.gaps.length;

    if (candidateIssueCount !== incumbentIssueCount) {
      return candidateIssueCount < incumbentIssueCount;
    }

    if (candidate.validation.score !== incumbent.validation.score) {
      return candidate.validation.score > incumbent.validation.score;
    }

    const candidateItems = Array.isArray(candidate.mutationInput?.items)
      ? candidate.mutationInput.items.length
      : 0;
    const incumbentItems = Array.isArray(incumbent.mutationInput?.items)
      ? incumbent.mutationInput.items.length
      : 0;

    if (candidateItems !== incumbentItems) {
      return candidateItems > incumbentItems;
    }

    const candidateConnections = Array.isArray(
      candidate.mutationInput?.connections,
    )
      ? candidate.mutationInput.connections.length
      : 0;
    const incumbentConnections = Array.isArray(
      incumbent.mutationInput?.connections,
    )
      ? incumbent.mutationInput.connections.length
      : 0;

    if (candidateConnections !== incumbentConnections) {
      return candidateConnections > incumbentConnections;
    }

    return candidate.attempt > incumbent.attempt;
  }

  private countHardSemanticViolations(
    validation: DesignValidationReport,
  ): number {
    const findings = [
      ...validation.missingRequirements,
      ...validation.gaps,
      ...validation.recommendations,
    ].map((entry) => entry.toLowerCase());

    const hardPatterns = [
      /blueprint requires async workflows/, // missing async queue/stream when required
      /missing persistence connection/, // stateful service persistence gap
      /gateway.*load balancer.*inverted|api gateway -> load balancer/, // ingress inversion
      /load balancer -> database|bypasses api\/service boundaries/, // LB direct DB access
      /cache->database read|reversed cache semantics/, // invalid cache pattern
      /disconnected component|orphan/, // structural orphan nodes
      /criticalissues=\d+/, // deterministic critical issues indicator
    ];

    let count = 0;
    for (const pattern of hardPatterns) {
      if (findings.some((entry) => pattern.test(entry))) {
        count += 1;
      }
    }

    return count;
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
