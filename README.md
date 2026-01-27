# llm-service

A Node.js middle layer for streaming and proxying LLM responses between your Next.js app and an Ubuntu VM running an AI inference model.

## APIs

- `GET /v1/llm/health` — Health check
- `POST /v1/llm/validate` — Validate prompt for length and content
- `POST /v1/llm/stream` — Stream LLM tokens as they are generated
- `POST /v1/llm/completion` — Get full completion (non-streaming)

## Best Practices

- **Prompt Validation:** Use `/v1/llm/validate` to check prompt length and content before forwarding to LLM.
- **Security:** Add authentication (API keys, JWT, etc.) and rate limiting. Sanitize prompts to avoid prompt injection.
- **Streaming:** Use HTTP streaming (SSE or chunked transfer) for `/v1/llm/stream` to minimize latency.
- **Observability:** Log requests, responses, and errors. Add metrics for latency and throughput.
- **Timeouts:** Set reasonable timeouts for upstream LLM requests.
- **Error Handling:** Return clear error messages and status codes.

## Optimizations for Token Throughput

- **Concise Prompts:** Encourage users to use shorter, more focused prompts.
- **Prompt Wrappers:** Add security-related wrappers to filter or rephrase prompts.
- **Batching:** If possible, batch requests or prefetch likely continuations.
- **Compression:** Use gzip/deflate for large responses.
- **Connection Keep-Alive:** Use HTTP keep-alive for upstream connections.

---

See `src/index.js` for implementation details.
