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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        this.httpService.post(
          `${url}/api/generate`,
          {
            model: 'mistral-nemo:latest',
            prompt: prompt,
            stream: false,
          },
          {
            timeout: 60000,
          },
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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        this.httpService.post<unknown>(
          `${url}/api/generate`,
          {
            model: 'mistral-nemo:latest',
            prompt: prompt,
            stream: true,
          },
          {
            responseType: 'stream',
            timeout: 60000,
          },
        ),
      );

      // This transformer converts Ollama JSON chunks into plain text tokens
      const tokenExtractor = new Transform({
        transform(chunk: Buffer, encoding, callback) {
          try {
            const raw = chunk.toString();
            // Ollama sends chunks that might contain multiple JSON objects
            const lines = raw.split('\n').filter((l) => l.trim());

            for (const line of lines) {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              const json = JSON.parse(line);
              // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
              if (json.response) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                this.push(json.response); // Push just the text part
              }
            }
          } catch {
            // Log if a chunk isn't valid JSON, but don't kill the stream
            console.warn('Could not parse chunk:', chunk.toString());
          }
          callback();
        },
      });

      return (response.data as NodeJS.ReadableStream).pipe(tokenExtractor);
    } catch (error) {
      console.error('LLM Connection Error:', (error as Error).message);
      throw new InternalServerErrorException('Failed to connect to LLM node');
    }
  }
}
