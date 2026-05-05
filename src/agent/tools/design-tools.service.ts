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
  displayName?: string;
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
  thumbnail?: string;
  uidata?: Record<string, unknown>;
  context?: Record<string, unknown>;
  designGroups?: Array<Record<string, unknown>>;
  items?: DesignItem[];
  connections?: DesignConnection[];
}

interface CreateDesignItem {
  name: string;
  displayName?: string;
  type: string;
  x?: number;
  y?: number;
  context?: unknown;
}

interface EnrichedItemContext {
  purpose: string;
  limitations: string;
  alternatives: string;
  scalingPlan: string;
}

interface CreateDesignConnection {
  from: string;
  to: string;
  label?: string;
  connectionType?: string;
  context?: unknown;
}

interface ExistingDesignConnectionSnapshot {
  from: string;
  to: string;
  label?: string;
}

interface CreateDesignGroup {
  name: string;
  displayName?: string;
  description?: string;
  x?: number;
  y?: number;
  borderColor?: string;
}

interface CreateDesignInput {
  name: string;
  description?: string;
  items: CreateDesignItem[];
  connections?: CreateDesignConnection[];
  designGroups?: CreateDesignGroup[];
}

interface UpdateDesignInput extends CreateDesignInput {
  designId: string;
}

interface MutationSessionGuard {
  hasMutation: boolean;
  designId?: string;
  operation?: 'create' | 'update';
}

interface LayoutItem {
  name: string;
  displayName?: string;
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
  getCreateSystemDesignTool(
    authToken: string,
    guard?: MutationSessionGuard,
  ): DynamicStructuredTool {
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
        designGroups: z
          .array(
            z.object({
              name: z
                .string()
                .describe(
                  'Name of the design group (e.g., "Gateway Layer", "Service Layer", "Data Layer")',
                ),
              description: z
                .string()
                .optional()
                .describe(
                  'Description of the group purpose (e.g., "API entry point", "Business logic services")',
                ),
              x: z
                .number()
                .optional()
                .describe(
                  'X coordinate for the group box (will auto-generate if not provided)',
                ),
              y: z
                .number()
                .optional()
                .describe(
                  'Y coordinate for the group box (will auto-generate if not provided)',
                ),
              borderColor: z
                .string()
                .optional()
                .describe(
                  'Border color for the group box (e.g., "#607D8B", "#FF9800")',
                ),
            }),
          )
          .optional()
          .describe(
            'Array of design groups to visually organize related components with dashed borders',
          ),
      }),
      func: async (input: CreateDesignInput) => {
        const { name, description, items, connections, designGroups } = input;
        try {
          if (guard?.hasMutation && guard.designId) {
            this.logger.warn(
              `Skipping duplicate create_system_design call in same attempt, reusing designId: ${guard.designId}`,
            );
            return JSON.stringify({
              success: true,
              designId: guard.designId,
              reused: true,
              operation: guard.operation,
              message:
                'Design mutation already executed in this attempt. Reusing previously mutated designId.',
            });
          }

          const connectionsArray = connections || [];
          const normalized = this.normalizeComponentNamesByType(
            items,
            connectionsArray,
          );
          this.logger.log(
            `Creating design: ${String(name)} with ${normalized.items.length} items`,
          );

          // Auto-generate layout if positions not provided
          const itemsWithLayout: LayoutItem[] = this.generateLayout(
            normalized.items,
          );

          const formattedConnections = this.buildFormattedConnections(
            normalized.connections,
            itemsWithLayout,
          );

          const persistedItemsWithLayout = this.pruneOrphanTextBoxItems(
            itemsWithLayout,
            formattedConnections,
          );

          // Transform items to match design-service schema with complete uidata
          const formattedItems = persistedItemsWithLayout.map(
            (item, index) => ({
              id: this.generateTempId(item.name, index),
              name: String(item.name),
              displayName: String(item.displayName || item.name),
              uidata: this.generateUIData(item, index),
              context: this.normalizeItemContext(
                item.context,
                item.name,
                item.type,
              ),
            }),
          );

          // Build groups with computed membership and bounding boxes.
          const formattedDesignGroups = this.buildDesignGroups(
            designGroups || [],
            persistedItemsWithLayout,
          );

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
            designGroups: formattedDesignGroups,
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

          if (guard) {
            guard.hasMutation = true;
            guard.designId = createdDesign.id;
            guard.operation = 'create';
          }

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
   * Tool 4: Update an existing system design with refined items and connections
   */
  getUpdateSystemDesignTool(
    authToken: string,
    guard?: MutationSessionGuard,
  ): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: 'update_system_design',
      description:
        'Update an existing system architecture design by designId. Use this during refinement loops to improve the SAME design instead of creating a new one.',
      schema: z.object({
        designId: z.string().describe('UUID of the existing design to update'),
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
        designGroups: z
          .array(
            z.object({
              name: z
                .string()
                .describe(
                  'Name of the design group (e.g., "Gateway Layer", "Service Layer", "Data Layer")',
                ),
              description: z
                .string()
                .optional()
                .describe(
                  'Description of the group purpose (e.g., "API entry point", "Business logic services")',
                ),
              x: z
                .number()
                .optional()
                .describe(
                  'X coordinate for the group box (will auto-generate if not provided)',
                ),
              y: z
                .number()
                .optional()
                .describe(
                  'Y coordinate for the group box (will auto-generate if not provided)',
                ),
              borderColor: z
                .string()
                .optional()
                .describe(
                  'Border color for the group box (e.g., "#607D8B", "#FF9800")',
                ),
            }),
          )
          .optional()
          .describe(
            'Array of design groups to visually organize related components with dashed borders',
          ),
      }),
      func: async (input: UpdateDesignInput) => {
        const {
          designId,
          name,
          description,
          items,
          connections,
          designGroups,
        } = input;
        try {
          if (guard?.hasMutation && guard.designId) {
            this.logger.warn(
              `Skipping duplicate update_system_design call in same attempt, reusing designId: ${guard.designId}`,
            );
            return JSON.stringify({
              success: true,
              designId: guard.designId,
              reused: true,
              operation: guard.operation,
              message:
                'Design mutation already executed in this attempt. Reusing previously mutated designId.',
            });
          }

          const current = await this.fetchDesignById(authToken, designId);
          const currentDesign = current as unknown as Partial<Design>;

          const currentItems: CreateDesignItem[] = (
            Array.isArray(currentDesign.items) ? currentDesign.items : []
          )
            .filter(
              (item): item is DesignItem => typeof item?.name === 'string',
            )
            .map((item) => {
              const uidata =
                item.uidata && typeof item.uidata === 'object'
                  ? (item.uidata as {
                      type?: unknown;
                      x?: unknown;
                      y?: unknown;
                    })
                  : undefined;

              return {
                name: item.name,
                displayName:
                  typeof item.displayName === 'string'
                    ? item.displayName
                    : undefined,
                type:
                  typeof item.type === 'string'
                    ? item.type
                    : typeof uidata?.type === 'string'
                      ? uidata.type
                      : 'other',
                x: typeof uidata?.x === 'number' ? uidata.x : undefined,
                y: typeof uidata?.y === 'number' ? uidata.y : undefined,
                context: item.context,
              };
            });

          const currentConnections: ExistingDesignConnectionSnapshot[] = (
            Array.isArray(currentDesign.connections)
              ? currentDesign.connections
              : []
          )
            .filter(
              (connection): connection is DesignConnection =>
                typeof connection.from?.name === 'string' &&
                typeof connection.to?.name === 'string',
            )
            .map((connection) => ({
              from: connection.from?.name || '',
              to: connection.to?.name || '',
              label:
                typeof connection.name === 'string'
                  ? connection.name
                  : typeof connection.label === 'string'
                    ? connection.label
                    : undefined,
            }));

          const normalizedIncoming = this.normalizeComponentNamesByType(
            items,
            connections || [],
          );

          let resilientItems = [...normalizedIncoming.items];
          const incomingConnectionsCount =
            normalizedIncoming.connections.length;
          const itemShrinkThreshold = Math.max(
            3,
            Math.ceil(currentItems.length * 0.6),
          );
          const shouldPreserveCurrentShape =
            (currentItems.length >= 6 &&
              normalizedIncoming.items.length < itemShrinkThreshold) ||
            (currentConnections.length >= 4 && incomingConnectionsCount === 0);

          if (shouldPreserveCurrentShape) {
            const incomingItemNames = new Set(
              normalizedIncoming.items
                .map((item) => item.name.toLowerCase())
                .filter((name) => name.length > 0),
            );
            const preservedItems = currentItems.filter(
              (item) => !incomingItemNames.has(item.name.toLowerCase()),
            );
            resilientItems = [...normalizedIncoming.items, ...preservedItems];

            this.logger.warn(
              `Update payload for ${designId} looked truncated or under-specified (${normalizedIncoming.items.length}/${currentItems.length} items, ${incomingConnectionsCount}/${currentConnections.length} connections). Preserving ${preservedItems.length} existing components.`,
            );
          }

          let connectionsArray = [...normalizedIncoming.connections];
          if (shouldPreserveCurrentShape) {
            const availableItems = new Set(
              resilientItems.map((item) => item.name.toLowerCase()),
            );
            const existingKeys = new Set(
              connectionsArray.map(
                (connection) =>
                  `${connection.from.toLowerCase()}|${connection.to.toLowerCase()}|${(connection.label || '').toLowerCase()}`,
              ),
            );

            const preservedConnections: CreateDesignConnection[] = [];
            for (const connection of currentConnections) {
              const fromKey = connection.from.toLowerCase();
              const toKey = connection.to.toLowerCase();
              if (!availableItems.has(fromKey) || !availableItems.has(toKey)) {
                continue;
              }

              const key = `${fromKey}|${toKey}|${(connection.label || '').toLowerCase()}`;
              if (existingKeys.has(key)) {
                continue;
              }

              preservedConnections.push({
                from: connection.from,
                to: connection.to,
                label: connection.label,
              });
              existingKeys.add(key);
            }

            if (preservedConnections.length > 0) {
              connectionsArray = [...connectionsArray, ...preservedConnections];
            }
          }

          this.logger.log(
            `Updating design: ${designId} with ${resilientItems.length} items`,
          );

          const itemsWithLayout: LayoutItem[] =
            this.generateLayout(resilientItems);

          const formattedConnections = this.buildFormattedConnections(
            connectionsArray,
            itemsWithLayout,
          );

          const persistedItemsWithLayout = this.pruneOrphanTextBoxItems(
            itemsWithLayout,
            formattedConnections,
          );

          const formattedItems = persistedItemsWithLayout.map(
            (item, index) => ({
              id: this.generateTempId(item.name, index),
              name: String(item.name),
              displayName: String(item.displayName || item.name),
              uidata: this.generateUIData(item, index),
              context: this.normalizeItemContext(
                item.context,
                item.name,
                item.type,
              ),
            }),
          );

          const formattedDesignGroups = this.buildDesignGroups(
            this.resolveIncomingDesignGroups(designGroups, currentDesign),
            persistedItemsWithLayout,
          );

          const currentContext =
            current.context && typeof current.context === 'object'
              ? (current.context as Record<string, unknown>)
              : {};

          const payload = {
            name: String(
              name ||
                (typeof current.name === 'string' && current.name
                  ? current.name
                  : 'Generated Design'),
            ),
            description:
              typeof description === 'string'
                ? description
                : typeof current.description === 'string'
                  ? current.description
                  : '',
            thumbnail: current.thumbnail || null,
            uidata: current.uidata || null,
            context: currentContext,
            items: formattedItems,
            connections: formattedConnections,
            designGroups: formattedDesignGroups,
          };

          await firstValueFrom(
            this.httpService.put(
              `${this.designServiceUrl}/api/v1/designs/${designId}`,
              payload,
              {
                headers: {
                  Authorization: `Bearer ${authToken}`,
                },
              },
            ),
          );

          if (guard) {
            guard.hasMutation = true;
            guard.designId = designId;
            guard.operation = 'update';
          }

          return JSON.stringify({
            success: true,
            designId,
            name: payload.name,
            itemsCount: formattedItems.length,
            connectionsCount: formattedConnections.length,
            updated: true,
          });
        } catch (error) {
          let errorMessage = 'Unknown error';
          let errorDetails = '';

          if (error instanceof Error) {
            errorMessage = error.message;
          }

          if (error && typeof error === 'object' && 'response' in error) {
            const httpError = error as HttpError;
            errorDetails = JSON.stringify({
              status: httpError.response?.status,
              statusText: httpError.response?.statusText,
              data: httpError.response?.data,
            });
          }

          const fullError = errorDetails || errorMessage;
          this.logger.error(`Error updating design: ${fullError}`);

          return JSON.stringify({
            success: false,
            error: 'Failed to update design',
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
        displayName: item.displayName,
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
   * Generate ID for design groups
   */
  private generateGroupId(name: string, index: number): string {
    return (
      name
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .substring(0, 30) + (index > 0 ? `-${index}` : '')
    );
  }

  /**
   * Get color for design group based on index
   */
  private getGroupColor(index: number): string {
    const colors = [
      '#607D8B', // Blue Grey
      '#FF9800', // Orange
      '#2196F3', // Blue
      '#4CAF50', // Green
      '#9C27B0', // Purple
      '#F44336', // Red
      '#00BCD4', // Cyan
      '#795548', // Brown
    ];
    return colors[index % colors.length];
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

  private buildDesignGroups(
    groups: CreateDesignGroup[],
    items: LayoutItem[],
  ): Array<Record<string, unknown>> {
    const drafts = groups.map((group, index) => {
      const members = this.resolveGroupMembers(group, items);
      const bounds = this.computeGroupBounds(group, members, index);
      return {
        group,
        index,
        members,
        bounds,
      };
    });

    const adjustedBounds = this.resolveDesignGroupOverlaps(
      drafts.map((draft) => draft.bounds),
      drafts.map((draft) => draft.members.length > 0),
    );

    return drafts.map((draft, index) => {
      const bounds = adjustedBounds[index] || draft.bounds;

      return {
        id: this.generateGroupId(draft.group.name, draft.index),
        name: String(draft.group.name),
        displayName: String(draft.group.displayName || draft.group.name),
        description: String(draft.group.description || ''),
        uidata: {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          borderColor:
            draft.group.borderColor || this.getGroupColor(draft.index),
          borderStyle: 'dashed',
          borderThickness: 2,
        },
        designs: draft.members.map((item) => ({
          name: item.name,
          type: 'DesignItem',
        })),
      };
    });
  }

  private resolveDesignGroupOverlaps(
    bounds: Array<{ x: number; y: number; width: number; height: number }>,
    hasMembers: boolean[],
  ): Array<{ x: number; y: number; width: number; height: number }> {
    const GAP = 24;
    const MAX_PASSES = 12;
    const resolved = bounds.map((box) => ({ ...box }));

    const intersects = (
      a: { x: number; y: number; width: number; height: number },
      b: { x: number; y: number; width: number; height: number },
    ): boolean => {
      const ax2 = a.x + a.width;
      const ay2 = a.y + a.height;
      const bx2 = b.x + b.width;
      const by2 = b.y + b.height;

      return a.x < bx2 && ax2 > b.x && a.y < by2 && ay2 > b.y;
    };

    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      let moved = false;

      for (let i = 0; i < resolved.length; i += 1) {
        for (let j = i + 1; j < resolved.length; j += 1) {
          const a = resolved[i];
          const b = resolved[j];

          if (!intersects(a, b)) {
            continue;
          }

          const aAnchored = hasMembers[i] === true;
          const bAnchored = hasMembers[j] === true;

          // Never shift boundaries that are anchored to actual member items.
          if (aAnchored && bAnchored) {
            continue;
          }

          const moveIndex = bAnchored && !aAnchored ? i : j;
          const fixedIndex = moveIndex === i ? j : i;
          const fixed = resolved[fixedIndex];
          const moving = resolved[moveIndex];

          const moveDownBy = fixed.y + fixed.height + GAP - moving.y;
          if (moveDownBy > 0) {
            moving.y += moveDownBy;
            moved = true;
          }
        }
      }

      if (!moved) {
        break;
      }
    }

    return resolved;
  }

  private resolveGroupMembers(
    group: CreateDesignGroup,
    items: LayoutItem[],
  ): LayoutItem[] {
    const signature = `${group.name} ${group.description || ''}`.toLowerCase();

    const typeMatches = (item: LayoutItem): boolean => {
      const type = item.type.toLowerCase();
      const name = item.name.toLowerCase();

      if (/client|frontend|presentation|user-facing|consumer/.test(signature)) {
        return (
          type === 'user' ||
          type === 'web-app' ||
          type === 'mobile-app' ||
          type === 'frontend'
        );
      }

      if (/gateway|edge|ingress/.test(signature)) {
        return (
          type === 'api-gateway' ||
          type === 'gateway' ||
          type === 'load-balancer' ||
          type === 'firewall'
        );
      }

      if (/service|business/.test(signature)) {
        return (
          type === 'microservice' ||
          type === 'service' ||
          type === 'backend' ||
          type === 'lambda'
        );
      }

      if (/data|storage|database|persistence/.test(signature)) {
        return type === 'database' || type === 'storage';
      }

      if (/cache|caching/.test(signature)) {
        return type === 'cache' || type === 'cdn';
      }

      if (/async|queue|messag|event|stream|processing/.test(signature)) {
        return (
          type === 'message-queue' ||
          type === 'queue' ||
          /queue|stream|kafka|sqs|worker|processor/.test(name)
        );
      }

      if (
        /telemetry|observability|monitor|metrics|logging|analytics/.test(
          signature,
        )
      ) {
        return (
          type === 'monitor' ||
          /telemetry|observability|monitor|metrics|logging|analytics/.test(name)
        );
      }

      return false;
    };

    const matched = items.filter(typeMatches);
    if (matched.length > 0) {
      return matched;
    }

    // Fallback: include nodes close to the provided group anchor.
    const anchorX = group.x ?? 100;
    const anchorY = group.y ?? 50;
    return items.filter(
      (item) =>
        Math.abs(item.x - anchorX) <= 260 && Math.abs(item.y - anchorY) <= 260,
    );
  }

  private computeGroupBounds(
    group: CreateDesignGroup,
    members: LayoutItem[],
    index: number,
  ): { x: number; y: number; width: number; height: number } {
    const fallbackX = group.x ?? 100 + index * 200;
    const fallbackY = group.y ?? 50;

    if (members.length === 0) {
      return {
        x: fallbackX,
        y: fallbackY,
        width: 280,
        height: 180,
      };
    }

    const PADDING_X = 40;
    const PADDING_Y = 36;

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const member of members) {
      const style = this.getTypeStyles(member.type);
      minX = Math.min(minX, member.x);
      minY = Math.min(minY, member.y);
      maxX = Math.max(maxX, member.x + style.width);
      maxY = Math.max(maxY, member.y + style.height);
    }

    return {
      x: Math.round(minX - PADDING_X),
      y: Math.round(minY - PADDING_Y),
      width: Math.round(Math.max(220, maxX - minX + PADDING_X * 2)),
      height: Math.round(Math.max(140, maxY - minY + PADDING_Y * 2)),
    };
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

  private buildFormattedConnections(
    connections: CreateDesignConnection[],
    items: LayoutItem[],
  ): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [];

    for (const connection of connections) {
      const fromResolved = this.resolveItemNameRef(connection.from, items);
      const toResolved = this.resolveItemNameRef(connection.to, items);

      if (!fromResolved || !toResolved) {
        this.logger.warn(
          `Skipping connection due to unresolved endpoint(s): from="${connection.from}" to="${connection.to}"`,
        );
        continue;
      }

      const connectionIndex = result.length;
      result.push({
        name: String(connection.label || 'Connection'),
        connectionType: connection.connectionType || undefined,
        from: { name: fromResolved, type: 'DesignItem' },
        to: { name: toResolved, type: 'DesignItem' },
        fromPoint: this.getConnectionPoint(connectionIndex, 'from'),
        toPoint: this.getConnectionPoint(connectionIndex, 'to'),
        uidata: this.generateConnectionUIData(
          String(connection.label || 'Connection'),
          connection.connectionType,
        ),
        context: connection.context,
      });
    }

    return result;
  }

  private pruneOrphanTextBoxItems(
    items: LayoutItem[],
    formattedConnections: Array<Record<string, unknown>>,
  ): LayoutItem[] {
    if (items.length === 0) {
      return items;
    }

    const connectedNames = new Set<string>();
    for (const connection of formattedConnections) {
      const fromObj =
        connection.from && typeof connection.from === 'object'
          ? (connection.from as { name?: unknown })
          : undefined;
      const toObj =
        connection.to && typeof connection.to === 'object'
          ? (connection.to as { name?: unknown })
          : undefined;

      if (typeof fromObj?.name === 'string') {
        connectedNames.add(fromObj.name.toLowerCase());
      }

      if (typeof toObj?.name === 'string') {
        connectedNames.add(toObj.name.toLowerCase());
      }
    }

    const filtered = items.filter((item) => {
      if (item.type.toLowerCase() !== 'text-box') {
        return true;
      }

      return connectedNames.has(item.name.toLowerCase());
    });

    const removedCount = items.length - filtered.length;
    if (removedCount > 0) {
      this.logger.log(
        `Pruned ${removedCount} orphan text-box item(s) before persisting design payload.`,
      );
    }

    return filtered;
  }

  private normalizeComponentNamesByType(
    items: CreateDesignItem[],
    connections: CreateDesignConnection[],
  ): { items: CreateDesignItem[]; connections: CreateDesignConnection[] } {
    const serviceCapableTypes = new Set([
      'microservice',
      'service',
      'backend',
      'lambda',
    ]);

    const renameMap = new Map<string, string>();
    const normalizedItems = items.map((item) => {
      const trimmedName = String(item.name || '').trim();
      const type = String(item.type || '').toLowerCase();

      if (!trimmedName || serviceCapableTypes.has(type)) {
        return item;
      }

      const renamed = trimmedName
        .replace(/\bservices\b$/i, '')
        .replace(/\bservice\b$/i, '')
        .trim();

      if (!renamed || renamed === trimmedName) {
        return item;
      }

      renameMap.set(this.normalizeLabel(trimmedName), renamed);
      return {
        ...item,
        name: renamed,
        displayName: item.displayName || renamed,
      };
    });

    const uniqueNames = new Set<string>();
    const dedupedItems = normalizedItems.map((item) => {
      const candidate = this.normalizeLabel(item.name);
      if (!candidate || !uniqueNames.has(candidate)) {
        if (candidate) {
          uniqueNames.add(candidate);
        }
        return item;
      }

      const fallbackName = this.uniqueName(item.name, uniqueNames);
      renameMap.set(this.normalizeLabel(item.name), fallbackName);
      return {
        ...item,
        name: fallbackName,
        displayName: item.displayName || fallbackName,
      };
    });

    if (renameMap.size === 0) {
      return { items, connections };
    }

    const normalizedConnections = connections.map((connection) => {
      const fromKey = this.normalizeLabel(connection.from);
      const toKey = this.normalizeLabel(connection.to);
      return {
        ...connection,
        from: renameMap.get(fromKey) || connection.from,
        to: renameMap.get(toKey) || connection.to,
      };
    });

    this.logger.log(
      `Normalized ${renameMap.size} non-compute component name(s) to remove redundant Service suffixes.`,
    );

    return {
      items: dedupedItems,
      connections: normalizedConnections,
    };
  }

  private resolveIncomingDesignGroups(
    incomingGroups: CreateDesignGroup[] | undefined,
    currentDesign: Partial<Design>,
  ): CreateDesignGroup[] {
    if (Array.isArray(incomingGroups) && incomingGroups.length > 0) {
      return incomingGroups;
    }

    const existing = Array.isArray(currentDesign.designGroups)
      ? currentDesign.designGroups
      : [];
    if (existing.length === 0) {
      return [];
    }

    const resolved: CreateDesignGroup[] = [];
    for (const group of existing) {
      const groupRecord =
        group && typeof group === 'object' && !Array.isArray(group)
          ? group
          : null;
      if (!groupRecord || typeof groupRecord.name !== 'string') {
        continue;
      }

      const uidata =
        groupRecord.uidata &&
        typeof groupRecord.uidata === 'object' &&
        !Array.isArray(groupRecord.uidata)
          ? (groupRecord.uidata as Record<string, unknown>)
          : null;

      resolved.push({
        name: groupRecord.name,
        description:
          typeof groupRecord.description === 'string'
            ? groupRecord.description
            : undefined,
        x: typeof uidata?.x === 'number' ? uidata.x : undefined,
        y: typeof uidata?.y === 'number' ? uidata.y : undefined,
        borderColor:
          typeof uidata?.borderColor === 'string'
            ? uidata.borderColor
            : undefined,
      });
    }

    return resolved;
  }

  private uniqueName(base: string, existing: Set<string>): string {
    let index = 2;
    let candidate = `${base} ${index}`;
    while (existing.has(this.normalizeLabel(candidate))) {
      index += 1;
      candidate = `${base} ${index}`;
    }
    existing.add(this.normalizeLabel(candidate));
    return candidate;
  }

  private resolveItemNameRef(
    rawName: string,
    items: LayoutItem[],
  ): string | null {
    const target = this.normalizeLabel(rawName);
    if (!target) {
      return null;
    }

    const exact = items.find(
      (item) => this.normalizeLabel(item.name) === target,
    );
    if (exact) {
      return exact.name;
    }

    const inclusiveMatches = items.filter((item) => {
      const normalized = this.normalizeLabel(item.name);
      return normalized.includes(target) || target.includes(normalized);
    });

    if (inclusiveMatches.length === 1) {
      return inclusiveMatches[0].name;
    }

    const tokenMatches = items.filter((item) => {
      const normalized = this.normalizeLabel(item.name);
      const targetTokens = target.split(' ').filter(Boolean);
      const itemTokens = normalized.split(' ').filter(Boolean);
      return targetTokens.every((token) => itemTokens.includes(token));
    });

    if (tokenMatches.length === 1) {
      return tokenMatches[0].name;
    }

    return null;
  }

  private normalizeLabel(value: string): string {
    return String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
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

  private normalizeItemContext(
    input: unknown,
    itemName: string,
    itemType: string,
  ): EnrichedItemContext {
    const fallback: EnrichedItemContext = {
      purpose: `${itemName} handles ${itemType} responsibilities in the architecture.`,
      limitations: `${itemName} has finite throughput and may require horizontal scaling under peak load.`,
      alternatives: `Alternative managed or open-source ${itemType} services can be used based on compliance and cost.`,
      scalingPlan: `Scale ${itemName} horizontally and apply caching/queueing where applicable to meet demand.`,
    };

    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return fallback;
    }

    const record = input as Record<string, unknown>;

    const readString = (key: keyof EnrichedItemContext): string => {
      const value = record[key];
      return typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : fallback[key];
    };

    return {
      purpose: readString('purpose'),
      limitations: readString('limitations'),
      alternatives: readString('alternatives'),
      scalingPlan: readString('scalingPlan'),
    };
  }

  async fetchDesignById(
    authToken: string,
    designId: string,
  ): Promise<Record<string, unknown>> {
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

    return response.data as Record<string, unknown>;
  }

  async attachDesignContext(
    authToken: string,
    designId: string,
    contextPatch: Record<string, unknown>,
  ): Promise<void> {
    try {
      const current = await this.fetchDesignById(authToken, designId);

      const existingContext =
        current.context && typeof current.context === 'object'
          ? (current.context as Record<string, unknown>)
          : {};

      const name =
        typeof current.name === 'string' && current.name.length > 0
          ? current.name
          : 'Generated Design';
      const description =
        typeof current.description === 'string' ? current.description : '';

      const payload = {
        name,
        description,
        thumbnail: current.thumbnail || null,
        uidata: current.uidata || null,
        context: {
          ...existingContext,
          ...contextPatch,
        },
        items: Array.isArray(current.items) ? current.items : [],
        connections: Array.isArray(current.connections)
          ? current.connections
          : [],
        designGroups: Array.isArray(current.designGroups)
          ? current.designGroups
          : [],
      };

      await firstValueFrom(
        this.httpService.put(
          `${this.designServiceUrl}/api/v1/designs/${designId}`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${authToken}`,
            },
          },
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to attach context for design ${designId}: ${message}`,
      );
      throw error;
    }
  }

  /**
   * Get all tools as an array
   */
  getAllTools(
    authToken: string,
    mode: 'create' | 'update' | 'both' = 'both',
  ): DynamicStructuredTool[] {
    const mutationGuard: MutationSessionGuard = {
      hasMutation: false,
    };

    const tools: DynamicStructuredTool[] = [
      this.getSearchExistingDesignsTool(authToken),
      this.getDesignByIdTool(authToken),
    ];

    if (mode !== 'update') {
      tools.push(this.getCreateSystemDesignTool(authToken, mutationGuard));
    }

    if (mode !== 'create') {
      tools.push(this.getUpdateSystemDesignTool(authToken, mutationGuard));
    }

    return tools;
  }
}
