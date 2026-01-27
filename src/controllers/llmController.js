const llmService = require('../services/llmService');
const axios = require('axios');

// Validate prompt (basic example)
exports.validatePrompt = (req, res) => {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== 'string' || prompt.length > 2048) {
    return res.status(400).json({ valid: false, reason: 'Invalid or too long prompt' });
  }
  // Add more security/content checks as needed
  res.json({ valid: true });
};

// Stream tokens from LLM (proxy streaming)
exports.streamTokens = async (req, res) => {
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
  } catch (err) {
    res.status(500).json({ error: 'LLM node error', details: err.message });
  }
};

// Non-streaming completion
exports.completion = async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt required' });
  try {
    const result = await llmService.queryLLM(prompt);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'LLM node error', details: err.message });
  }
};
