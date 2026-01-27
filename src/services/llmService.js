// Service for LLM business logic
const axios = require('axios');

exports.queryLLM = async (prompt) => {
  // Proxy to LLM node for completion
  const url = process.env.LLM_NODE_URL || 'http://ubuntu-llm-node:8000/completion';
  const response = await axios.post(url, { prompt });
  return response.data;
};
