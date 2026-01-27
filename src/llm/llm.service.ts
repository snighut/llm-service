/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { Response } from 'express';
import { firstValueFrom } from 'rxjs';
import { Readable } from 'stream';

@Injectable()
export class LlmService {
  constructor(private readonly httpService: HttpService) {}

  async streamTokens(prompt: string, res: Response): Promise<void> {
    const url = process.env.OLLAMA_HOST || 'http://ubuntu-llm-node:8000';

    try {
      const response = await firstValueFrom(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
        this.httpService.post<Readable>(
          `${url}/stream`,
          { prompt },
          {
            responseType: 'stream',
            timeout: 60000,
          },
        ),
      );

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const stream: Readable = response.data as Readable;

      stream.on('data', (chunk) => {
        res.write(chunk);
      });

      stream.on('end', () => {
        res.end();
      });

      stream.on('error', (err) => {
        console.error('Stream error:', err);
        if (!res.headersSent) {
          res.status(500).send('Stream processing failed');
        } else {
          res.end();
        }
      });
    } catch (error) {
      console.error('LLM Node Connection Error:', (error as Error).message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to connect to LLM node' });
      }
    }
  }

  async completion(prompt: string): Promise<any> {
    const url =
      process.env.OLLAMA_HOST || 'http://ubuntu-llm-node:8000/completion';
    try {
      // 1. Await the AxiosResponse and ensure the type is any for .data access
      const response = await firstValueFrom(
        this.httpService.post<any>(url, { prompt }),
      );
      return response.data;
    } catch (error) {
      console.error('LLM completion error:', (error as Error).message);
      throw new InternalServerErrorException('LLM completion failed');
    }
  }
}
