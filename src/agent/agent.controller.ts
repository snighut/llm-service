import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Query,
  HttpStatus,
  HttpException,
  Logger,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { AgentService } from './agent.service';
import { AgentTraceService } from './agent-trace.service';
import { GenerateDesignDto } from './dto/generate-design.dto';
import { DesignResultDto, DesignErrorDto } from './dto/design-result.dto';
import {
  AgentDebugRunDetailResponseDto,
  AgentDebugRunListResponseDto,
} from './dto/agent-debug.dto';

interface JwtPayloadLike {
  sub?: unknown;
}

interface RequestWithUser extends Request {
  user?: string | JwtPayloadLike;
}

@ApiTags('agent')
@Controller('agent')
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(
    private readonly agentService: AgentService,
    private readonly traceService: AgentTraceService,
  ) {}

  /**
   * Generate a system design from natural language query
   */
  @Post('generate-design')
  @UseGuards(SupabaseAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Generate system design from natural language',
    description:
      'Uses an AI agent with tool calling to automatically create system architecture designs based on user queries. The agent can search existing templates, analyze patterns, and create production-ready designs.',
  })
  @ApiBody({ type: GenerateDesignDto })
  @ApiResponse({
    status: 201,
    description: 'Design created successfully',
    type: DesignResultDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request',
    type: DesignErrorDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing authentication token',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error',
    type: DesignErrorDto,
  })
  async generateDesign(
    @Body() dto: GenerateDesignDto,
    @Req() request: RequestWithUser,
  ): Promise<DesignResultDto> {
    try {
      this.logger.log(`Received design generation request: ${dto.query}`);

      // Validate query
      if (!dto.query || dto.query.trim().length === 0) {
        throw new HttpException(
          {
            error: 'Invalid query',
            details: 'Query cannot be empty',
            statusCode: HttpStatus.BAD_REQUEST,
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      if (dto.query.length > 2000) {
        throw new HttpException(
          {
            error: 'Query too long',
            details: 'Query must be less than 2000 characters',
            statusCode: HttpStatus.BAD_REQUEST,
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // Extract authorization token from request
      const authHeader = request.headers['authorization'] as string;
      const accessToken = authHeader?.startsWith('Bearer ')
        ? authHeader.substring(7)
        : authHeader;
      const userId = this.extractUserId(request.user);

      // Generate design using agent with user's token
      const result = await this.agentService.generateDesign(
        dto,
        accessToken,
        userId,
      );

      this.logger.log(`Design generated successfully: ${result.designId}`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Error generating design: ${errorMessage}`, errorStack);

      // If it's already an HttpException, rethrow it
      if (error instanceof HttpException) {
        throw error;
      }

      // Otherwise, wrap in 500 error
      const errorDetails =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new HttpException(
        {
          error: 'Design generation failed',
          details: errorDetails,
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('debug/runs')
  @UseGuards(SupabaseAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'List recent agent runs for authenticated user',
    description:
      'Returns trace summaries including status, duration, and selected result metadata.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Maximum number of runs to return (1-100). Defaults to 20.',
    example: 20,
  })
  @ApiResponse({
    status: 200,
    description: 'List of recent trace summaries',
    type: AgentDebugRunListResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  listDebugRuns(
    @Req() request: RequestWithUser,
    @Query('limit') limitRaw?: string,
  ) {
    const userId = this.extractUserId(request.user);
    const parsedLimit = Number(limitRaw);
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 20;
    const runs = this.traceService.listRuns(userId, limit);

    return {
      runs,
      count: runs.length,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('debug/runs/:runId')
  @UseGuards(SupabaseAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get full agent run trace by runId',
    description:
      'Includes stage timeline and tool replay payloads for debugging and replay.',
  })
  @ApiParam({
    name: 'runId',
    type: String,
    description:
      'Trace run id returned from generate-design metadata.traceRunId',
  })
  @ApiResponse({
    status: 200,
    description: 'Full trace payload',
    type: AgentDebugRunDetailResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Run not found' })
  getDebugRun(@Req() request: RequestWithUser, @Param('runId') runId: string) {
    const userId = this.extractUserId(request.user);
    const run = this.traceService.getRun(runId, userId);
    if (!run) {
      throw new HttpException(
        {
          error: 'Trace run not found',
          details: `No run found for runId: ${runId}`,
          statusCode: HttpStatus.NOT_FOUND,
        },
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      run,
      timestamp: new Date().toISOString(),
    };
  }

  private extractUserId(user?: string | JwtPayloadLike): string | undefined {
    if (!user || typeof user === 'string') {
      return undefined;
    }

    if ('sub' in user && typeof user.sub === 'string' && user.sub.length > 0) {
      return user.sub;
    }

    return undefined;
  }

  /**
   * Health check for agent service
   */
  @Get('health')
  @ApiOperation({ summary: 'Check agent service health' })
  @ApiResponse({
    status: 200,
    description: 'Service is healthy',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'healthy' },
        model: { type: 'string', example: 'mistral-nemo:latest' },
      },
    },
  })
  async health() {
    try {
      const result = await this.agentService.healthCheck();
      return {
        service: 'agent',
        ...result,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Health check failed: ${errorMessage}`);
      throw new HttpException(
        {
          service: 'agent',
          status: 'unhealthy',
          error: errorMessage,
          timestamp: new Date().toISOString(),
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
