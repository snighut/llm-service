import axios from 'axios';

export const queryLLM = async (prompt: string): Promise<any> => {
  const url =
    process.env.LLM_NODE_URL || 'http://ubuntu-llm-node:8000/completion';
  const response = await axios.post(url, { prompt });
  return response.data;
};
