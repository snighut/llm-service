import { Injectable, Logger } from '@nestjs/common';
import { ChatOllama } from '@langchain/ollama';
import {
  AgentExecutor,
  createToolCallingAgent,
} from '@langchain/classic/agents';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { DesignToolsService } from './tools/design-tools.service';
import { GenerateDesignDto } from './dto/generate-design.dto';
import { DesignResultDto } from './dto/design-result.dto';

/**
 * Agent Service - Orchestrates LLM with tool calling for design generation
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly llm: ChatOllama;
  private agentExecutor: AgentExecutor | null = null;
  private initializationError: Error | null = null;

  constructor(private readonly designToolsService: DesignToolsService) {
    // Initialize Ollama LLM
    this.llm = new ChatOllama({
      baseUrl: process.env.OLLAMA_HOST || 'http://localhost:11434',
      model: process.env.OLLAMA_MODEL || 'mistral-nemo:latest',
      temperature: 0.7, // Balance creativity and consistency
    });

    this.logger.log(
      `Agent initialized with model: ${process.env.OLLAMA_MODEL || 'mistral-nemo:latest'}`,
    );
    this.initializeAgent();
  }

  /**
   * Initialize the agent with tools and prompt
   */
  private initializeAgent() {
    try {
      const tools = this.designToolsService.getAllTools();

      // System prompt that guides the agent's behavior
      const prompt = ChatPromptTemplate.fromMessages([
        [
          'system',
          `You are an expert system architect AI agent that helps users design software architectures.

Your capabilities:
- Search existing design templates in the database
- Analyze and learn from existing designs
- Create new system architecture designs with components and connections

Your workflow:
1. Understand the user's requirements from their query
2. Search for similar existing designs using search_existing_designs tool
3. If found, analyze the template using get_design_by_id tool to understand structure
4. Plan the architecture based on requirements and templates
5. Create the design using create_system_design tool with:
   - Appropriate component types (service, database, queue, cache, gateway, frontend, backend)
   - Meaningful component names based on the user's requirements
   - Logical connections between components
   - Reasonable layout positioning

Component Type Guidelines:
- "service/microservice" → type: "service"
- "database/DB/storage" → type: "database"
- "cache/Redis/Memcached" → type: "cache"
- "queue/Kafka/RabbitMQ/messaging" → type: "queue"
- "API Gateway/Gateway/load balancer" → type: "gateway"
- "frontend/UI/web app" → type: "frontend"
- "backend/API server" → type: "backend"

Connection Guidelines:
- Gateway → Services: label "REST API" or "gRPC"
- Service → Database: label "SQL" or "NoSQL"
- Service → Queue: label "Pub/Sub" or "Message Queue"
- Service → Cache: label "Cache"
- Service → Service: label "REST", "gRPC", or "Event-driven"

IMPORTANT: Always call create_system_design tool to create the actual design. Return the design ID when done.`,
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
      this.agentExecutor = new AgentExecutor({
        agent,
        tools,
        verbose: true, // Enable detailed logging
        maxIterations: 15, // Prevent infinite loops
        returnIntermediateSteps: true, // Return reasoning steps
      });

      this.logger.log('Agent executor initialized successfully');
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
   * Generate a system design based on natural language query
   */
  async generateDesign(dto: GenerateDesignDto): Promise<DesignResultDto> {
    const startTime = Date.now();
    this.logger.log(`Generating design for query: ${dto.query}`);

    // Check if agent is initialized
    if (!this.agentExecutor) {
      const errorMsg = this.initializationError
        ? `Agent not initialized: ${this.initializationError.message}`
        : 'Agent executor is not initialized';
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    try {
      // Execute agent with the query
      const result = await this.agentExecutor.invoke({
        input: dto.query,
        chat_history: [], // Could be extended for conversation history
      });

      this.logger.log('Agent execution completed');
      this.logger.log(`Agent output: ${JSON.stringify(result.output)}`);

      // Extract design ID from the result
      const designId = this.extractDesignId(String(result.output));

      if (!designId) {
        throw new Error('Agent failed to create design or return design ID');
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
   * Extract design ID from agent output
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
