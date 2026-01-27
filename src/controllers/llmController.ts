import { Request, Response } from 'express';
import { queryLLM } from '../services/llmService';
// import axios from 'axios'; // Commented out as it's not used in NestJS

export const validatePrompt = (req: Request, res: Response) => {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== 'string' || prompt.length > 2048) {
    return res
      .status(400)
      .json({ valid: false, reason: 'Invalid or too long prompt' });
  }
  res.json({ valid: true });
};

// The streamTokens and completion functions have been removed as they are not used in the NestJS project.
