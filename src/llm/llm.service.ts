import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Readable, Transform } from 'stream';

@Injectable()
export class LlmService {
  constructor(private readonly httpService: HttpService) {}

  async completion(prompt: string): Promise<any> {
    const url = process.env.OLLAMA_HOST;
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${url}/api/generate`,
          {
            model: 'mistral-nemo:latest',
            prompt: prompt,
            stream: false,
          },
          { timeout: 60000 },
        ),
      );
      return response.data;
    } catch (error) {
      console.error('LLM Completion Error:', (error as Error).message);
      throw new InternalServerErrorException(
        'Failed to get completion from LLM node',
      );
    }
  }

  async streamTokens(prompt: string): Promise<Readable> {
    const url = process.env.OLLAMA_HOST;
    try {
      const response = await firstValueFrom(
        this.httpService.post<Readable>(
          `${url}/api/generate`,
          {
            model: 'mistral-nemo:latest',
            prompt: prompt,
            stream: true,
            options: {
              num_predict: 100,
              stop: [],
              num_ctx: 4096,
              temperature: 0.7,
            },
          },
          {
            responseType: 'stream',
            timeout: 60000,
          },
        ),
      );
      const tokenExtractor = new Transform({
        transform(chunk: Buffer, encoding, callback) {
          try {
            const raw = chunk.toString();
            const lines = raw.split('\n').filter((l) => l.trim());
            for (const line of lines) {
              const json: { response?: string; done?: boolean } = JSON.parse(line);
              if (json.response) {
                this.push(`data: ${json.response}\n\n`);
              }
              if (json.done) {
                this.push('data: [DONE]\n\n');
                this.push(null);
              }
            }
          } catch {
            console.warn('Could not parse chunk:', chunk.toString());
          }
          callback();
        },
      });
      const outputStream = (response.data as Readable).pipe(tokenExtractor);
      outputStream.push(`: ${' '.repeat(4096)}\n\n`);
      const heartbeat = setInterval(() => {
        if (!outputStream.destroyed) {
          outputStream.push(': heartbeat\n\n');
        }
      }, 15000);
      outputStream.on('close', () => clearInterval(heartbeat));
      outputStream.on('end', () => clearInterval(heartbeat));
      return outputStream;
    } catch (error) {
      console.error('LLM Connection Error:', (error as Error).message);
      throw new InternalServerErrorException('Failed to connect to LLM node');
    }
  }
}
