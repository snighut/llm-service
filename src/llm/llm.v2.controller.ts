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
import { LlmV2Service } from './llm.v2.service';
import { RagService } from './rag.service';
import { Writable } from 'stream';

@Controller('llm/v2')
export class LlmV2Controller {
  constructor(
    private readonly llmService: LlmV2Service,
    private readonly ragService: RagService,
  ) {}

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

  @Get('rag') // GET is more reliable for mobile carriers
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache, no-transform') // no-transform tells Cloudflare not to buffer
  @Header('Connection', 'keep-alive') // Explicitly for Safari
  @Header('X-Accel-Buffering', 'no') // Disables Nginx/proxy buffering
  async rag(@Query('prompt') prompt: string, @Res() res: Response) {
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
        stream.cancel();
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
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache, no-transform') // no-transform tells Cloudflare not to buffer
  @Header('Connection', 'keep-alive') // Explicitly for Safari
  @Header('X-Accel-Buffering', 'no') // Disables Nginx/proxy buffering
  async stream(@Query('prompt') prompt: string, @Res() res: Response) {
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
