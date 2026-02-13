import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

interface HttpError {
  response?: {
    status?: number;
    statusText?: string;
    data?: unknown;
  };
}

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
  connectionType?: string;
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
  width: number;
  height: number;
  context?: unknown;
}

interface UIData {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  zIndex: number;
  backgroundColor: string;
  borderColor: string;
  borderThickness: number;
  borderStyle: string;
  color: string;
  fontSize: number;
  fontStyle: string;
}

/**
 * Service that provides LangChain tools for interacting with design-service APIs
 */
@Injectable()
export class DesignToolsService {
  private readonly logger = new Logger(DesignToolsService.name);
  private readonly designServiceUrl: string;

  constructor(private readonly httpService: HttpService) {
    this.designServiceUrl =
      process.env.DESIGN_SERVICE_URL || 'http://localhost:3001';
    this.logger.log(`Design service URL: ${this.designServiceUrl}`);
  }

  /**
   * Tool 1: Search for existing designs in the database
   */
  getSearchExistingDesignsTool(authToken: string): DynamicStructuredTool {
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
                Authorization: `Bearer ${authToken}`,
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
          let errorMessage = 'Unknown error';
          let errorDetails = '';

          if (error instanceof Error) {
            errorMessage = error.message;
          }

          // Capture HTTP error details
          if (error && typeof error === 'object' && 'response' in error) {
            const httpError = error as HttpError;
            errorDetails = JSON.stringify({
              status: httpError.response?.status,
              statusText: httpError.response?.statusText,
              data: httpError.response?.data,
            });
          }

          const fullError = errorDetails || errorMessage;
          this.logger.error(`Error searching designs: ${fullError}`);
          return JSON.stringify({
            error: 'Failed to search designs',
            details: fullError,
          });
        }
      },
    });
  }

  /**
   * Tool 2: Get a complete design by ID (including items and connections)
   */
  getDesignByIdTool(authToken: string): DynamicStructuredTool {
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
                  Authorization: `Bearer ${authToken}`,
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
          let errorMessage = 'Unknown error';
          let errorDetails = '';

          if (error instanceof Error) {
            errorMessage = error.message;
          }

          // Capture HTTP error details
          if (error && typeof error === 'object' && 'response' in error) {
            const httpError = error as HttpError;
            errorDetails = JSON.stringify({
              status: httpError.response?.status,
              statusText: httpError.response?.statusText,
              data: httpError.response?.data,
            });
          }

          const fullError = errorDetails || errorMessage;
          this.logger.error(`Error fetching design: ${fullError}`);
          return JSON.stringify({
            error: 'Failed to fetch design',
            details: fullError,
          });
        }
      },
    });
  }

  /**
   * Tool 3: Create a new system design with items and connections
   */
  getCreateSystemDesignTool(authToken: string): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: 'create_system_design',
      description:
        'Create a new system architecture design with components and connections. REQUIRED: name (string), items (array). OPTIONAL: description, connections. This is the final step after planning. Use this when you have determined all the components and their connections.',
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
                  // New visual component types
                  'api-gateway',
                  'microservice',
                  'database',
                  'cache',
                  'message-queue',
                  'load-balancer',
                  'storage',
                  'cdn',
                  'lambda',
                  'container',
                  'kubernetes',
                  'cloud',
                  'server',
                  'user',
                  'mobile-app',
                  'web-app',
                  'firewall',
                  'monitor',
                  'text-box',
                  // Legacy types (still supported)
                  'service',
                  'gateway',
                  'frontend',
                  'backend',
                  'queue',
                  'other',
                ])
                .describe(
                  'Component type: Use specific visual types like api-gateway, microservice, database, cache, message-queue, etc. for professional diagrams. Use text-box ONLY as fallback when no specific type matches. Legacy types (service, gateway, frontend, backend, queue, other) still supported.',
                ),
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
              connectionType: z
                .string()
                .optional()
                .describe(
                  'Connection type for visual styling: restApi, graphql, grpc, messageQueue, eventBus, databaseConnection, cacheConnection, dataFlow, apiCall, synchronousCall, asynchronousCall, publishSubscribe',
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
          const formattedConnections = connectionsArray.map((conn, index) => ({
            name: String(conn.label || 'Connection'),
            connectionType: conn.connectionType || undefined,
            from: { name: String(conn.from), type: 'DesignItem' },
            to: { name: String(conn.to), type: 'DesignItem' },
            fromPoint: this.getConnectionPoint(index, 'from'),
            toPoint: this.getConnectionPoint(index, 'to'),
            uidata: this.generateConnectionUIData(
              String(conn.label || 'Connection'),
              conn.connectionType,
            ),
            context: conn.context,
          }));

          // Transform items to match design-service schema with complete uidata
          const formattedItems = itemsWithLayout.map((item, index) => ({
            id: this.generateTempId(item.name, index),
            name: String(item.name),
            uidata: this.generateUIData(item, index),
            context: item.context,
          }));

          // Create design using design-service API
          const payload = {
            name: String(name),
            description: String(
              description || `Auto-generated design: ${name}`,
            ),
            thumbnail: null,
            context: {
              generatedBy: 'agent',
              timestamp: new Date().toISOString(),
              tags: this.extractTags(items),
            },
            items: formattedItems,
            connections: formattedConnections,
            designGroups: [],
          };

          this.logger.log(
            `Sending payload to design-service: ${JSON.stringify(payload, null, 2)}`,
          );

          const response = await firstValueFrom(
            this.httpService.post(
              `${this.designServiceUrl}/api/v1/designs`,
              payload,
              {
                headers: {
                  Authorization: `Bearer ${authToken}`,
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
          let errorMessage = 'Unknown error';
          let errorDetails = '';

          if (error instanceof Error) {
            errorMessage = error.message;
          }

          // Capture HTTP error details
          if (error && typeof error === 'object' && 'response' in error) {
            const httpError = error as HttpError;
            errorDetails = JSON.stringify({
              status: httpError.response?.status,
              statusText: httpError.response?.statusText,
              data: httpError.response?.data,
            });
          }

          const fullError = errorDetails || errorMessage;
          this.logger.error(`Error creating design: ${fullError}`);
          this.logger.error(
            `Payload that failed: ${JSON.stringify({ name, description, itemsCount: items.length, connectionsCount: (connections || []).length })}`,
          );

          return JSON.stringify({
            success: false,
            error: 'Failed to create design',
            details: fullError,
          });
        }
      },
    });
  }

  /**
   * Generate layout for items if positions are not provided
   */
  private generateLayout(items: CreateDesignItem[]): LayoutItem[] {
    const START_X = 100;
    const START_Y = 100;
    const SPACING = 50;
    const ITEMS_PER_ROW = 3;

    return items.map((item, index) => {
      const dimensions = this.getTypeDimensions();
      const row = Math.floor(index / ITEMS_PER_ROW);
      const col = index % ITEMS_PER_ROW;

      return {
        name: item.name,
        type: item.type,
        x:
          item.x !== undefined
            ? item.x
            : START_X + col * (dimensions.width + SPACING),
        y:
          item.y !== undefined
            ? item.y
            : START_Y + row * (dimensions.height + SPACING),
        width: dimensions.width,
        height: dimensions.height,
        context: item.context,
      };
    });
  }

  /**
   * Get default dimensions based on component type
   * Using simpler dimensions that match working examples
   */
  private getTypeDimensions(): { width: number; height: number } {
    // All types use text-like dimensions for better UI rendering
    return { width: 120, height: 40 };
  }

  /**
   * Get type-specific styling and map to visual component types
   */
  private getTypeStyles(type: string): {
    type: string;
    backgroundColor: string;
    borderColor: string;
    width: number;
    height: number;
  } {
    // Map all component types to their visual styles with dimensions
    const styleMap: Record<
      string,
      {
        type: string;
        backgroundColor: string;
        borderColor: string;
        width: number;
        height: number;
      }
    > = {
      // New visual architectural component types with specific dimensions
      'api-gateway': {
        type: 'api-gateway',
        backgroundColor: '#FF6B6B',
        borderColor: '#FF6B6B',
        width: 100,
        height: 80,
      },
      microservice: {
        type: 'microservice',
        backgroundColor: '#4ECDC4',
        borderColor: '#4ECDC4',
        width: 90,
        height: 90,
      },
      database: {
        type: 'database',
        backgroundColor: '#45B7D1',
        borderColor: '#45B7D1',
        width: 80,
        height: 100,
      },
      cache: {
        type: 'cache',
        backgroundColor: '#FFC107',
        borderColor: '#FFC107',
        width: 90,
        height: 70,
      },
      'message-queue': {
        type: 'message-queue',
        backgroundColor: '#96CEB4',
        borderColor: '#96CEB4',
        width: 100,
        height: 70,
      },
      'load-balancer': {
        type: 'load-balancer',
        backgroundColor: '#9B59B6',
        borderColor: '#9B59B6',
        width: 100,
        height: 80,
      },
      storage: {
        type: 'storage',
        backgroundColor: '#D4A5A5',
        borderColor: '#D4A5A5',
        width: 90,
        height: 100,
      },
      cdn: {
        type: 'cdn',
        backgroundColor: '#FF6B6B',
        borderColor: '#FF6B6B',
        width: 90,
        height: 90,
      },
      lambda: {
        type: 'lambda',
        backgroundColor: '#FF9500',
        borderColor: '#FF9500',
        width: 80,
        height: 80,
      },
      container: {
        type: 'container',
        backgroundColor: '#0066CC',
        borderColor: '#0066CC',
        width: 85,
        height: 85,
      },
      kubernetes: {
        type: 'kubernetes',
        backgroundColor: '#326CE5',
        borderColor: '#326CE5',
        width: 90,
        height: 90,
      },
      cloud: {
        type: 'cloud',
        backgroundColor: '#4ECDC4',
        borderColor: '#4ECDC4',
        width: 110,
        height: 70,
      },
      server: {
        type: 'server',
        backgroundColor: '#34495E',
        borderColor: '#34495E',
        width: 85,
        height: 100,
      },
      user: {
        type: 'user',
        backgroundColor: '#95A5A6',
        borderColor: '#95A5A6',
        width: 70,
        height: 80,
      },
      'mobile-app': {
        type: 'mobile-app',
        backgroundColor: '#1ABC9C',
        borderColor: '#1ABC9C',
        width: 60,
        height: 100,
      },
      'web-app': {
        type: 'web-app',
        backgroundColor: '#3498DB',
        borderColor: '#3498DB',
        width: 100,
        height: 80,
      },
      firewall: {
        type: 'firewall',
        backgroundColor: '#E74C3C',
        borderColor: '#E74C3C',
        width: 85,
        height: 95,
      },
      monitor: {
        type: 'monitor',
        backgroundColor: '#F39C12',
        borderColor: '#F39C12',
        width: 95,
        height: 80,
      },
      'text-box': {
        type: 'text-box',
        backgroundColor: '#7F8C8D',
        borderColor: '#7F8C8D',
        width: 100,
        height: 80,
      },
      // Legacy types mapped to text boxes with colors
      service: {
        type: 'text',
        backgroundColor: '#e0f2fe',
        borderColor: '#0369a1',
        width: 120,
        height: 40,
      },
      gateway: {
        type: 'text',
        backgroundColor: '#dbeafe',
        borderColor: '#1e40af',
        width: 120,
        height: 40,
      },
      frontend: {
        type: 'text',
        backgroundColor: '#fef3e2',
        borderColor: '#ea580c',
        width: 120,
        height: 40,
      },
      backend: {
        type: 'text',
        backgroundColor: '#dcfce7',
        borderColor: '#16a34a',
        width: 120,
        height: 40,
      },
      queue: {
        type: 'text',
        backgroundColor: '#ede9fe',
        borderColor: '#7c3aed',
        width: 120,
        height: 40,
      },
      other: {
        type: 'text',
        backgroundColor: '#f3f4f6',
        borderColor: '#6b7280',
        width: 120,
        height: 40,
      },
    };

    return (
      styleMap[type] || {
        type: 'text',
        backgroundColor: '#f3f4f6',
        borderColor: '#333333',
        width: 120,
        height: 40,
      }
    );
  }

  /**
   * Generate complete uidata with all required and recommended fields
   * Uses specific component types for visual rendering with type-specific dimensions
   */
  private generateUIData(item: LayoutItem, index: number): UIData {
    const style = this.getTypeStyles(item.type);

    return {
      x: item.x,
      y: item.y,
      type: style.type, // Use specific type for visual components
      color: style.borderColor, // Use borderColor for text to match icon color and contrast
      width: style.width, // Use type-specific width
      height: style.height, // Use type-specific height
      zIndex: index + 1, // Increment zIndex for each item
      content: item.name,
      backgroundColor: 'transparent',
      borderColor: style.borderColor,
      borderThickness: 2,
      borderStyle: 'solid',
      fontSize: 14,
      fontStyle: 'normal',
    };
  }

  /**
   * Generate temporary ID for items
   */
  private generateTempId(name: string, index: number): string {
    const sanitizedName = name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    const timestamp = Date.now().toString().slice(-6);
    return `temp-${sanitizedName}-${index}-${timestamp}`;
  }

  /**
   * Generate connection points (alternating pattern for better visual layout)
   */
  private getConnectionPoint(index: number, direction: 'from' | 'to'): string {
    const points = ['right', 'left', 'bottom', 'top'];
    if (direction === 'from') {
      return points[index % 2 === 0 ? 0 : 2]; // right or bottom
    }
    return points[index % 2 === 0 ? 1 : 3]; // left or top
  }

  /**
   * Generate uidata for connections with styling based on label and type
   */
  private generateConnectionUIData(
    label: string,
    connectionType?: string,
  ): Record<string, unknown> {
    // Determine connection style based on connectionType or label
    const labelLower = label.toLowerCase();
    let borderColor = '#00897B';
    let borderStyle: 'solid' | 'dashed' | 'dotted' = 'solid';
    const linePattern: 'curved' | 'straight' | 'stepped' = 'curved';

    // Map connectionType to visual styles
    if (connectionType) {
      if (
        connectionType.includes('message') ||
        connectionType.includes('event') ||
        connectionType.includes('async') ||
        connectionType.includes('publish')
      ) {
        borderColor = '#7c3aed';
        borderStyle = 'dashed';
      } else if (
        connectionType.includes('database') ||
        connectionType.includes('sql')
      ) {
        borderColor = '#d97706';
      } else if (connectionType.includes('cache')) {
        borderColor = '#be185d';
      } else if (
        connectionType.includes('api') ||
        connectionType.includes('rest') ||
        connectionType.includes('grpc') ||
        connectionType.includes('graphql')
      ) {
        borderColor = '#0369a1';
      }
    } else {
      // Fallback to label-based detection
      if (
        labelLower.includes('async') ||
        labelLower.includes('event') ||
        labelLower.includes('queue') ||
        labelLower.includes('message') ||
        labelLower.includes('publish') ||
        labelLower.includes('subscribe')
      ) {
        borderColor = '#7c3aed';
        borderStyle = 'dashed';
      } else if (
        labelLower.includes('metric') ||
        labelLower.includes('telemetry') ||
        labelLower.includes('log')
      ) {
        borderColor = '#FF6F00';
        borderStyle = 'dashed';
      } else if (labelLower.includes('cache') || labelLower.includes('redis')) {
        borderColor = '#be185d';
      } else if (
        labelLower.includes('database') ||
        labelLower.includes('sql')
      ) {
        borderColor = '#d97706';
      } else if (
        labelLower.includes('http') ||
        labelLower.includes('rest') ||
        labelLower.includes('api')
      ) {
        borderColor = '#0369a1';
      }
    }

    return {
      borderColor,
      borderThickness: 2,
      borderStyle,
      linePattern, // All connections use smooth curves by default
    };
  }

  /**
   * Extract tags from items for context metadata
   */
  private extractTags(items: CreateDesignItem[]): string[] {
    const tags = new Set<string>();
    items.forEach((item) => {
      tags.add(item.type);
    });
    return Array.from(tags);
  }

  /**
   * Get all tools as an array
   */
  getAllTools(authToken: string): DynamicStructuredTool[] {
    return [
      this.getSearchExistingDesignsTool(authToken),
      this.getDesignByIdTool(authToken),
      this.getCreateSystemDesignTool(authToken),
    ];
  }
}
