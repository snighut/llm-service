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
            stream: false, // FIXED: Completion should be false to get full JSON back
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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        this.httpService.post<Readable>(
          `${url}/api/generate`,
          {
            model: 'mistral-nemo:latest',
            prompt: prompt,
            stream: true,
            options: {
              num_predict: 50, // Guard: stops generation after ~50 tokens
              stop: ['\n'], // Guard: stops generation at newline// Guard: stops if the LLM tries to start a new paragraph
              temperature: 0.7, // Optional: keeps responses creative but focused
            },
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
              const json: { response?: string; done?: boolean } =
                JSON.parse(line);
              if (json.response) {
                // SSE format: must start with 'data: ' and end with TWO newlines
                this.push(`data: ${json.response}\n\n`);
                // this.push(json.response); // Push just the text part
              }
              if (json.done) {
                // Optional: signal the end of the stream
                this.push('data: [DONE]\n\n');
                this.push(null); // Explicitly end the stream when Ollama is done
              }
            }
          } catch {
            // Log if a chunk isn't valid JSON, but don't kill the stream
            console.warn('Could not parse chunk:', chunk.toString());
          }
          callback();
        },
      });

      const outputStream = (response.data as Readable).pipe(tokenExtractor);
      // 1. INITIAL WAKE-UP: Send ~1KB of "invisible" padding.
      // Starting with ":" makes this an SSE comment, which browsers ignore.
      // This forces mobile carriers and Cloudflare to flush the buffer immediately.
      outputStream.push(`: ${' '.repeat(4096)}\n\n`);

      // 2. HEARTBEAT: Keep it small but use the SSE comment format ": heartbeat"
      // This ensures the connection stays open without adding spaces to your chat UI.
      const heartbeat = setInterval(() => {
        if (!outputStream.destroyed) {
          outputStream.push(': heartbeat\n\n');
        }
      }, 15000);

      // ADDED: Heartbeat to keep Cloudflare Tunnel alive
      // const heartbeat = setInterval(() => {
      //   if (!outputStream.destroyed) {
      //     outputStream.push(' '); // Send a space every 15s to reset idle timers
      //   }
      // }, 15000);

      outputStream.on('close', () => clearInterval(heartbeat));
      outputStream.on('end', () => clearInterval(heartbeat));

      return outputStream;
    } catch (error) {
      console.error('LLM Connection Error:', (error as Error).message);
      throw new InternalServerErrorException('Failed to connect to LLM node');
    }
  }
}
