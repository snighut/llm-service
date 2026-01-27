import { Router } from 'express';
import llmRoutes from './llm';

const router = Router();
router.use('/v1/llm', llmRoutes);
export default router;
