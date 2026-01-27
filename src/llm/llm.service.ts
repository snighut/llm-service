import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { Response } from 'express';

@Injectable()
export class LlmService {
  async streamTokens(prompt: string, res: Response) {
    const url = process.env.LLM_NODE_URL || 'http://ubuntu-llm-node:8000/stream';
    const response = await axios({
      method: 'post',
      url,
      data: { prompt },
      responseType: 'stream',
      timeout: 60000,
    });
    res.setHeader('Content-Type', 'text/event-stream');
    response.data.pipe(res);
  }

  async completion(prompt: string) {
    const url = process.env.LLM_NODE_URL || 'http://ubuntu-llm-node:8000/completion';
    const response = await axios.post(url, { prompt });
    return response.data;
  }
}
