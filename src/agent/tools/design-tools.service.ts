import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

interface DesignItem {
  id?: string;
  name: string;
  type: string;
  description?: string;
  items?: unknown[];
  connections?: unknown[];
  uidata?: {
    x?: number;
    y?: number;
  };
  context?: unknown;
}

interface DesignConnection {
  from?: { name?: string; type?: string };
  to?: { name?: string; type?: string };
  name?: string;
  label?: string;
}

interface Design {
  id: string;
  name: string;
  description?: string;
  items?: DesignItem[];
  connections?: DesignConnection[];
}

interface CreateDesignItem {
  name: string;
  type: string;
  x?: number;
  y?: number;
  context?: unknown;
}

interface CreateDesignConnection {
  from: string;
  to: string;
  label?: string;
  context?: unknown;
}

interface CreateDesignInput {
  name: string;
  description?: string;
  items: CreateDesignItem[];
  connections?: CreateDesignConnection[];
}

interface LayoutItem {
  name: string;
  type: string;
  x: number;
  y: number;
  context?: unknown;
}

/**
 * Service that provides LangChain tools for interacting with design-service APIs
 */
@Injectable()
export class DesignToolsService {
  private readonly logger = new Logger(DesignToolsService.name);
  private readonly designServiceUrl: string;
  private readonly authToken: string;

  constructor(private readonly httpService: HttpService) {
    this.designServiceUrl =
      process.env.DESIGN_SERVICE_URL || 'http://localhost:3001';
    this.authToken = process.env.DESIGN_SERVICE_TOKEN || 'cant find it';
    this.logger.log(`Design service URL: ${this.designServiceUrl}`);
  }

  /**
   * Tool 1: Search for existing designs in the database
   */
  getSearchExistingDesignsTool(): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: 'search_existing_designs',
      description:
        'Search for similar system designs in database to use as templates. Returns array of matching designs with IDs, names, and descriptions. Use this when the user asks to create a design similar to existing patterns.',
      schema: z.object({
        query: z
          .string()
          .describe(
            'Search query for finding similar designs (e.g., "microservices", "e-commerce", "event-driven")',
          ),
      }),
      func: async ({ query }) => {
        try {
          this.logger.log(`Searching designs with query: ${String(query)}`);

          // Call design-service to search designs
          const response = await firstValueFrom(
            this.httpService.get(`${this.designServiceUrl}/api/v1/designs`, {
              headers: {
                Authorization: this.authToken,
              },
            }),
          );

          const designs = response.data as Design[];

          // Filter designs based on query (simple text matching)
          const queryLower = String(query).toLowerCase();
          const filtered = designs.filter((design) => {
            const searchText =
              `${design.name} ${design.description || ''}`.toLowerCase();
            return searchText.includes(queryLower);
          });

          // Return simplified results for the LLM
          const results = filtered.slice(0, 5).map((design) => ({
            id: design.id,
            name: design.name,
            description: design.description || 'No description',
          }));

          this.logger.log(`Found ${results.length} matching designs`);
          return JSON.stringify(results);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          this.logger.error(`Error searching designs: ${errorMessage}`);
          return JSON.stringify({
            error: 'Failed to search designs',
            details: errorMessage,
          });
        }
      },
    });
  }

  /**
   * Tool 2: Get a complete design by ID (including items and connections)
   */
  getDesignByIdTool(): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: 'get_design_by_id',
      description:
        'Fetch complete design including all items and connections by ID. Use this to get template structure from similar designs that you found using search_existing_designs.',
      schema: z.object({
        designId: z.string().describe('UUID of the design to fetch'),
      }),
      func: async ({ designId }) => {
        try {
          this.logger.log(`Fetching design with ID: ${designId}`);

          const response = await firstValueFrom(
            this.httpService.get(
              `${this.designServiceUrl}/api/v1/designs/${designId}`,
              {
                headers: {
                  Authorization: this.authToken,
                },
              },
            ),
          );

          const design = response.data as Design;

          // Return structure that LLM can understand
          const result = {
            id: design.id,
            name: design.name,
            description: design.description,
            itemsCount: design.items?.length || 0,
            connectionsCount: design.connections?.length || 0,
            items:
              design.items?.map((item) => ({
                name: item.name,
                type: item.type,
                position: { x: item.uidata?.x, y: item.uidata?.y },
              })) || [],
            connections:
              design.connections?.map((conn) => ({
                from: conn.from?.name,
                to: conn.to?.name,
                label: conn.name,
              })) || [],
          };

          this.logger.log(
            `Fetched design: ${design.name} with ${result.itemsCount} items`,
          );
          return JSON.stringify(result);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          this.logger.error(`Error fetching design: ${errorMessage}`);
          return JSON.stringify({
            error: 'Failed to fetch design',
            details: errorMessage,
          });
        }
      },
    });
  }

  /**
   * Tool 3: Create a new system design with items and connections
   */
  getCreateSystemDesignTool(): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: 'create_system_design',
      description:
        'Create a new system architecture design with components and connections. This is the final step after planning. Use this when you have determined all the components and their connections.',
      schema: z.object({
        name: z.string().describe('Name of the system design'),
        description: z
          .string()
          .optional()
          .describe('Detailed description of the architecture'),
        items: z
          .array(
            z.object({
              name: z
                .string()
                .describe(
                  'Name of the component (e.g., "API Gateway", "User Service")',
                ),
              type: z
                .enum([
                  'service',
                  'database',
                  'queue',
                  'cache',
                  'gateway',
                  'frontend',
                  'backend',
                  'other',
                ])
                .describe('Type of component'),
              x: z
                .number()
                .optional()
                .describe(
                  'X coordinate for positioning (will auto-generate if not provided)',
                ),
              y: z
                .number()
                .optional()
                .describe(
                  'Y coordinate for positioning (will auto-generate if not provided)',
                ),
              context: z
                .any()
                .optional()
                .describe('Additional metadata about this component'),
            }),
          )
          .describe('Array of design components/items'),
        connections: z
          .array(
            z.object({
              from: z.string().describe('Name of the source component'),
              to: z.string().describe('Name of the target component'),
              label: z
                .string()
                .optional()
                .describe(
                  'Connection label (e.g., "REST API", "Message Queue", "gRPC")',
                ),
              context: z
                .any()
                .optional()
                .describe('Additional metadata about this connection'),
            }),
          )
          .optional()
          .describe('Array of connections between items'),
      }),
      func: async (input: CreateDesignInput) => {
        const { name, description, items, connections } = input;
        try {
          const connectionsArray = connections || [];
          this.logger.log(
            `Creating design: ${String(name)} with ${items.length} items`,
          );

          // Auto-generate layout if positions not provided
          const itemsWithLayout: LayoutItem[] = this.generateLayout(items);

          // Transform connections to match design-service schema
          const formattedConnections = connectionsArray.map((conn) => ({
            from: { name: String(conn.from), type: 'DesignItem' },
            to: { name: String(conn.to), type: 'DesignItem' },
            name: String(conn.label || 'Connection'),
            context: conn.context,
          }));

          // Transform items to match design-service schema
          const formattedItems = itemsWithLayout.map((item) => ({
            name: String(item.name),
            type: String(item.type),
            uidata: {
              x: item.x,
              y: item.y,
            },
            context: item.context,
          }));

          // Create design using design-service API
          const payload = {
            name: String(name),
            description: String(
              description || `Auto-generated design: ${name}`,
            ),
            items: formattedItems,
            connections: formattedConnections,
            context: {
              generatedBy: 'agent',
              timestamp: new Date().toISOString(),
            },
          };

          const response = await firstValueFrom(
            this.httpService.post(
              `${this.designServiceUrl}/api/v1/designs`,
              payload,
              {
                headers: {
                  Authorization: this.authToken,
                },
              },
            ),
          );

          const createdDesign = response.data as Design;

          this.logger.log(
            `Successfully created design with ID: ${createdDesign.id}`,
          );

          return JSON.stringify({
            success: true,
            designId: createdDesign.id,
            name: createdDesign.name,
            itemsCount: formattedItems.length,
            connectionsCount: formattedConnections.length,
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          this.logger.error(`Error creating design: ${errorMessage}`);
          return JSON.stringify({
            success: false,
            error: 'Failed to create design',
            details: errorMessage,
          });
        }
      },
    });
  }

  /**
   * Generate layout for items if positions are not provided
   */
  private generateLayout(items: CreateDesignItem[]): LayoutItem[] {
    const SPACING_X = 250;
    const SPACING_Y = 200;
    const START_X = 100;
    const START_Y = 100;
    const ITEMS_PER_ROW = 4;

    return items.map((item, index) => {
      const row = Math.floor(index / ITEMS_PER_ROW);
      const col = index % ITEMS_PER_ROW;

      return {
        name: item.name,
        type: item.type,
        x: item.x !== undefined ? item.x : START_X + col * SPACING_X,
        y: item.y !== undefined ? item.y : START_Y + row * SPACING_Y,
        context: item.context,
      };
    });
  }

  /**
   * Get all tools as an array
   */
  getAllTools(): DynamicStructuredTool[] {
    return [
      this.getSearchExistingDesignsTool(),
      this.getDesignByIdTool(),
      this.getCreateSystemDesignTool(),
    ];
  }
}
