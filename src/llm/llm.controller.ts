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
import { LlmService } from './llm.service';

@Controller('llm')
export class LlmController {
  constructor(private readonly llmService: LlmService) {}

  @Get('health')
  health(@Res() res: Response) {
    return res.status(HttpStatus.OK).json({ status: 'ok' });
  }

  @Post('validate')
  validate(@Body('prompt') prompt: string, @Res() res: Response) {
    if (!prompt || typeof prompt !== 'string' || prompt.length > 2048) {
      return res
        .status(HttpStatus.BAD_REQUEST)
        .json({ valid: false, reason: 'Invalid or too long prompt' });
    }
    return res.json({ valid: true });
  }

  @Get('stream') // Changed to GET to improve mobile carrier streaming stability
  @Header('Content-Type', 'text/event-stream') // Standard for streaming
  @Header('Cache-Control', 'no-cache, no-transform') // no-transform is key for Cloudflare
  @Header('Connection', 'keep-alive')
  @Header('X-Accel-Buffering', 'no') // Standard for disabling Nginx/proxy buffering
  async stream(@Query('prompt') prompt: string, @Res() res: Response) {
    // Changed @Body to @Query since we are now using GET parameters
    if (!prompt)
      return res
        .status(HttpStatus.BAD_REQUEST)
        .json({ error: 'Prompt required' });
    try {
      const stream = await this.llmService.streamTokens(prompt);
      stream.pipe(res);
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

  @Post('completion')
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
}
