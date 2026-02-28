import {
  Controller,
  Get,
  Post,
  Body,
  Res,
  HttpStatus,
  Header,
  Query,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { LlmV2Service } from './llm.v2.service';
import { RagService } from './rag.service';
import { Writable } from 'stream';
import { LoggerService } from '../logs/logger.service';

@ApiTags('llm-v2')
@Controller('llm/v2')
export class LlmV2Controller {
  constructor(
    private readonly llmService: LlmV2Service,
    private readonly ragService: RagService,
    private readonly logger: LoggerService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  health(@Res() res: Response) {
    return res.status(HttpStatus.OK).json({ status: 'ok' });
  }

  @Post('validate')
  @ApiOperation({ summary: 'Validate prompt before sending to LLM' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', example: 'What is microservices?' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Validation result' })
  @ApiResponse({ status: 400, description: 'Invalid prompt' })
  validate(@Body('prompt') prompt: string, @Res() res: Response) {
    if (!prompt || typeof prompt !== 'string' || prompt.length > 2048) {
      return res
        .status(HttpStatus.BAD_REQUEST)
        .json({ valid: false, reason: 'Invalid or too long prompt' });
    }
    return res.json({ valid: true });
  }

  @Get('rag') // GET is more reliable for mobile carriers
  @ApiOperation({
    summary: 'RAG streaming endpoint (Server-Sent Events)',
    description:
      'Streams LLM responses with RAG context from vector database. Returns text/event-stream format.',
  })
  @ApiQuery({
    name: 'prompt',
    required: true,
    type: String,
    example: 'What are the benefits of microservices?',
  })
  @ApiResponse({
    status: 200,
    description: 'Streaming response (not compatible with Postman)',
  })
  @ApiResponse({ status: 400, description: 'Prompt required' })
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache, no-transform') // no-transform tells Cloudflare not to buffer
  @Header('Connection', 'keep-alive') // Explicitly for Safari
  @Header('X-Accel-Buffering', 'no') // Disables Nginx/proxy buffering
  async rag(@Query('prompt') prompt: string, @Res() res: Response) {
    this.logger.log(`rag endpoint called with prompt: ${prompt}`);
    // 1. Force remove headers that cause instant HTTP/2 protocol errors in Safari/Chrome
    res.removeHeader('Connection');
    res.removeHeader('Transfer-Encoding');
    res.removeHeader('Upgrade');

    if (!prompt) {
      return res
        .status(HttpStatus.BAD_REQUEST)
        .json({ error: 'Prompt required' });
    }

    try {
      // 2. Flush headers IMMEDIATELY so the radio stays open
      res.flushHeaders();

      // 3. Start the LLM stream. stream' is a Web Stream (IterableReadableStream)
      const stream = await this.ragService.getResponse(prompt);

      // 'res' is a Node.js Writable stream.
      // This line converts 'res' into a Web WritableStream.
      const webWritable = Writable.toWeb(res);

      // 4. Pipe the data
      await stream.pipeTo(webWritable);

      // 5. CRITICAL: Cleanup if the user closes the tab or the mobile carrier drops the signal
      res.on('close', () => {
        void stream.cancel();
      });
    } catch (err: unknown) {
      const message =
        typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message?: unknown }).message)
          : 'Unknown error';

      // Only send error if headers haven't been sent yet
      if (!res.headersSent) {
        res
          .status(HttpStatus.INTERNAL_SERVER_ERROR)
          .json({ error: 'LLM node error', details: message });
      }
    }
  }

  @Get('stream') // GET is more reliable for mobile carriers
  @ApiOperation({
    summary: 'Basic LLM streaming endpoint (Server-Sent Events)',
    description:
      'Streams LLM responses without RAG context. Returns text/event-stream format.',
  })
  @ApiQuery({
    name: 'prompt',
    required: true,
    type: String,
    example: 'Explain quantum computing',
  })
  @ApiResponse({
    status: 200,
    description: 'Streaming response (not compatible with Postman)',
  })
  @ApiResponse({ status: 400, description: 'Prompt required' })
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache, no-transform') // no-transform tells Cloudflare not to buffer
  @Header('Connection', 'keep-alive') // Explicitly for Safari
  @Header('X-Accel-Buffering', 'no') // Disables Nginx/proxy buffering
  async stream(@Query('prompt') prompt: string, @Res() res: Response) {
    this.logger.log(`stream endpoint called with prompt: ${prompt}`);
    // 1. Force remove headers that cause instant HTTP/2 protocol errors in Safari/Chrome
    res.removeHeader('Connection');
    res.removeHeader('Transfer-Encoding');
    res.removeHeader('Upgrade');

    if (!prompt) {
      return res
        .status(HttpStatus.BAD_REQUEST)
        .json({ error: 'Prompt required' });
    }

    try {
      // 2. Flush headers IMMEDIATELY so the radio stays open
      res.flushHeaders();

      // 3. Start the LLM stream
      const stream = await this.llmService.streamTokens(prompt);

      // 4. Pipe the data
      stream.pipe(res);

      // 5. CRITICAL: Cleanup if the user closes the tab or the mobile carrier drops the signal
      res.on('close', () => {
        if (typeof stream.destroy === 'function') {
          stream.destroy();
        }
      });
    } catch (err: unknown) {
      const message =
        typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message?: unknown }).message)
          : 'Unknown error';

      // Only send error if headers haven't been sent yet
      if (!res.headersSent) {
        res
          .status(HttpStatus.INTERNAL_SERVER_ERROR)
          .json({ error: 'LLM node error', details: message });
      }
    }
  }

  @Post('completion')
  @ApiOperation({
    summary: 'Basic LLM completion (non-streaming)',
    description: 'Returns complete LLM response without RAG context.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', example: 'What is artificial intelligence?' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'LLM completion response' })
  @ApiResponse({ status: 400, description: 'Prompt required' })
  @ApiResponse({ status: 500, description: 'LLM error' })
  async completion(@Body('prompt') prompt: string, @Res() res: Response) {
    if (!prompt)
      return res
        .status(HttpStatus.BAD_REQUEST)
        .json({ error: 'Prompt required' });
    try {
      const result: unknown = await this.llmService.completion(prompt);
      res.json(result);
    } catch (err: unknown) {
      const message =
        typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message?: unknown }).message)
          : 'Unknown error';
      res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .json({ error: 'LLM node error', details: message });
    }
  }

  @Post('rag-completion')
  @ApiOperation({
    summary: 'RAG completion (non-streaming, Postman compatible)',
    description:
      'Returns complete LLM response with RAG context from ingested documents. Works with Postman and regular HTTP clients.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          example: 'What are the benefits of microservices architecture?',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'RAG completion response',
    schema: {
      type: 'object',
      properties: {
        response: {
          type: 'string',
          example:
            'Based on the provided context, the benefits of using microservices architecture include: 1. Scaling Applications...',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Prompt required' })
  @ApiResponse({ status: 500, description: 'RAG completion error' })
  async ragCompletion(@Body('prompt') prompt: string, @Res() res: Response) {
    this.logger.log(`rag-completion endpoint called with prompt: ${prompt}`);
    if (!prompt) {
      return res
        .status(HttpStatus.BAD_REQUEST)
        .json({ error: 'Prompt required' });
    }

    try {
      const result = await this.ragService.getCompletion(prompt);
      return res.json({ response: result });
    } catch (err: unknown) {
      const message =
        typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message?: unknown }).message)
          : 'Unknown error';
      this.logger.error(`RAG completion error: ${message}`);
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .json({ error: 'RAG completion error', details: message });
    }
  }
}
