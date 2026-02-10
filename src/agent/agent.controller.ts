import {
  Controller,
  Post,
  Body,
  Get,
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
} from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { AgentService } from './agent.service';
import { GenerateDesignDto } from './dto/generate-design.dto';
import { DesignResultDto, DesignErrorDto } from './dto/design-result.dto';

@ApiTags('agent')
@Controller('agent')
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(private readonly agentService: AgentService) {}

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
    @Req() request: Request,
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

      // Generate design using agent with user's token
      const result = await this.agentService.generateDesign(dto, accessToken);

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
