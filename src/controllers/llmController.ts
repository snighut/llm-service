import { Request, Response } from 'express';
import { queryLLM } from '../services/llmService';
import axios from 'axios';

export const validatePrompt = (req: Request, res: Response) => {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== 'string' || prompt.length > 2048) {
    return res.status(400).json({ valid: false, reason: 'Invalid or too long prompt' });
  }
  res.json({ valid: true });
};

export const streamTokens = async (req: Request, res: Response) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt required' });
  try {
    const response = await axios({
      method: 'post',
      url: process.env.LLM_NODE_URL || 'http://ubuntu-llm-node:8000/stream',
      data: { prompt },
      responseType: 'stream',
      timeout: 60000
    });
    res.setHeader('Content-Type', 'text/event-stream');
    response.data.pipe(res);
  } catch (err: any) {
    res.status(500).json({ error: 'LLM node error', details: err.message });
  }
};

export const completion = async (req: Request, res: Response) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt required' });
  try {
    const result = await queryLLM(prompt);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: 'LLM node error', details: err.message });
  }
};
