const express = require('express');
const router = express.Router();
const llmController = require('../controllers/llmController');

// Health check
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Validate prompt
router.post('/validate', llmController.validatePrompt);

// Stream tokens from LLM
router.post('/stream', llmController.streamTokens);

// Non-streaming completion
router.post('/completion', llmController.completion);

module.exports = router;
