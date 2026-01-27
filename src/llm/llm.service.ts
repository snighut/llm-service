import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { Response } from 'express';

@Injectable()
export class LlmService {
  async streamTokens(prompt: string, res: Response) {
    const url =
      process.env.LLM_NODE_URL || 'http://ubuntu-llm-node:8000/stream';
    const response = await axios({
      method: 'post',
      url,
      data: { prompt },
      responseType: 'stream',
      timeout: 60000,
    });
    res.setHeader('Content-Type', 'text/event-stream');
    // Type assertion for NodeJS.ReadableStream
    const stream = response.data as any as NodeJS.ReadableStream;
    if (stream && typeof stream.pipe === 'function') {
      stream.pipe(res);
    } else {
      res.status(500).json({ error: 'LLM node did not return a stream' });
    }
  }

  async completion(prompt: string) {
    const url =
      process.env.LLM_NODE_URL || 'http://ubuntu-llm-node:8000/completion';
    const response = await axios.post(url, { prompt });
    return response.data;
  }
}
