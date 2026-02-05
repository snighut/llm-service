import { Injectable } from '@nestjs/common';
import { Readable } from 'stream';
import { RagService } from './rag.service';

@Injectable()
export class LlmV2Service {
  constructor(private readonly ragService: RagService) {
    try {
      if (!ragService) {
        throw new Error('ragService dependency is undefined!');
      }
    } catch (err) {
      console.error('Error initializing LlmV2Service:', err);
      throw err;
    }
  }

  async completion(prompt: string): Promise<any> {
    const stream = await this.ragService.getResponse(prompt);
    let response = '';
    for await (const chunk of stream) {
      response += chunk;
    }
    return { response };
  }

  async streamTokens(prompt: string): Promise<Readable> {
    const stream = await this.ragService.getResponse(prompt);
    const iterator = stream[Symbol.asyncIterator]();
    const readable = new Readable({
      read() {
        iterator
          .next()
          .then(({ value, done }) => {
            if (done) {
              this.push(null);
            } else {
              this.push(value);
            }
          })
          .catch((err) => {
            this.destroy(err);
          });
      },
    });
    return readable;
  }
}
