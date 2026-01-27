import { Router, Request, Response } from 'express';
import * as llmController from '../controllers/llmController';

const router = Router();

router.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

router.post('/validate', llmController.validatePrompt);
router.post('/stream', llmController.streamTokens);
router.post('/completion', llmController.completion);

export default router;
