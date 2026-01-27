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

  @Get('stream') // GET is more reliable for mobile carriers
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache, no-transform') // no-transform tells Cloudflare not to buffer
  @Header('X-Accel-Buffering', 'no') // Disables Nginx/proxy buffering
  async stream(@Query('prompt') prompt: string, @Res() res: Response) {
    // 1. Force remove headers that cause instant HTTP/2 protocol errors in Safari/Chrome
    res.removeHeader('Connection');
    res.removeHeader('Transfer-Encoding');
    res.removeHeader('Keep-Alive');
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
        stream.destroy();
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
