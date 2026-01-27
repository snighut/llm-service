// Basic test for llmService
const { queryLLM } = require('../src/services/llmService');

test('queryLLM returns expected response', async () => {
  const input = 'test input';
  const result = await queryLLM(input);
  expect(result.response).toContain(input);
});
