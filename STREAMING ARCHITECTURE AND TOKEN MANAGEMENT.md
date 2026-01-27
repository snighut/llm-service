This documentation summarizes a generic production architecture for a streaming LLM service and its client application, running in a Kubernetes cluster and interacting with an LLM backend.

---

## 🛠 Streaming Architecture & Token Management

### 1. The Streaming Mechanism (Flow over Block)

Instead of waiting for the LLM to finish the entire response (which causes high latency), this architecture uses **Chunked Transfer Encoding** via Server-Sent Events (SSE).

- **LLM Backend:** Configured with `stream: true`. It emits a partial JSON object every time a new token is generated.
- **API Service:** Uses a `Transform` stream to intercept raw buffers from the LLM backend, extracts text tokens, and pushes them immediately into the response pipe.
- **Heartbeat Logic:** Pushes a "keep-alive" space character every 15 seconds to prevent proxies and ingress controllers from killing the connection during periods of LLM "thinking."

- **Frontend Client:** Uses a `ReadableStreamDefaultReader` in the frontend, processes chunks as they arrive using a `while` loop and a `TextDecoder`.
- **Buffer Management:** Handles partial SSE frames by buffering incoming text until a complete data packet (`\n\n`) is detected.

### 2. Security & Guardrails

To protect infrastructure resources (such as RAM and GPU in the cluster or backend node), three layers of restriction are implemented:

| Layer           | Method             | Purpose                                                                                             |
| --------------- | ------------------ | --------------------------------------------------------------------------------------------------- |
| **Model Guard** | `num_predict: 100` | Hard limit on the number of tokens generated per request to prevent runaway loops.                  |
| **Formatting**  | `stop: []`         | Can be set to `\n` to force single-line responses.                                                  |
| **Context**     | `num_ctx: 4096`    | Limits the "memory" of the model to save compute/memory resources.                                  |
| **Network**     | `AbortController`  | Frontend can signal the backend to kill the inference if the user closes the chat or clicks "Stop." |

### 3. API Reliability (The Cloudflare Factor)

When traffic is tunneled through a proxy (such as Cloudflare), use specific HTTP headers to bypass "Edge Buffering" that can break streams:

- `Content-Type: text/event-stream`: Identifies the response as a continuous stream.
- `Cache-Control: no-no-transform`: **Critical for Cloudflare.** It prevents the proxy from trying to compress or "optimize" the stream, which would otherwise delay token delivery.
- `X-Accel-Buffering: no`: Tells the Nginx Ingress to flush every byte to the client immediately.

---

## 📱 Mobile Browser Reliability Roadmap

While the desktop experience is now stable, some mobile browsers (such as Mobile Safari) are more aggressive with power-saving and connection termination. To achieve 100% reliability on mobile, the following steps remain:

1. **The 256-Byte Padding Hack:** Some browsers may refuse to start a stream until a certain amount of data is received. Send a "warm-up" comment of whitespace at the very start of the request.
2. **HTTP/2 to HTTP/1.1 Downgrade:** In the proxy/tunnel config, forcing the origin request to HTTP/1.1 can resolve "instant termination" bugs seen on some mobile devices using HTTP/2.
3. **Connection: Keep-Alive:** Explicitly set the `Connection` header to `keep-alive` to satisfy strict socket management.
4. **Rocket Loader Exclusion:** Disable any proxy/optimization features (such as Cloudflare Rocket Loader) for the streaming path, as it can interfere with the way browsers initialize the `TextDecoder`.

---

**Would you like a sample YAML configuration for a proxy tunnel to force the HTTP/1.1 downgrade?**
