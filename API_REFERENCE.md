# Agent API Quick Reference

## Base URL
```
http://localhost:3001  # Development
http://llm-service:3001  # Kubernetes
```

## Endpoints

### 🤖 Generate Design
```http
POST /agent/generate-design
Content-Type: application/json

{
  "query": "Design a microservices architecture for an e-commerce platform",
  "options": {
    "useTemplates": true,
    "enableWebSearch": false,
    "maxComponents": 20,
    "maxIterations": 10
  }
}
```

**Response 201:**
```json
{
  "designId": "550e8400-e29b-41d4-a716-446655440000",
  "name": "E-commerce Microservices Architecture",
  "message": "Design created successfully",
  "reasoning": [
    "Used tool: search_existing_designs with input: {\"query\":\"microservices ecommerce\"}",
    "Result: Found 2 matching designs...",
    "Used tool: get_design_by_id with input: {\"designId\":\"...\"}",
    "Result: Analyzed template structure...",
    "Used tool: create_system_design with input: {\"name\":\"...\"}",
    "Result: {\"success\":true,\"designId\":\"550e8400-e29b-41d4-a716-446655440000\"}"
  ],
  "metadata": {
    "componentsCount": 8,
    "connectionsCount": 12,
    "processingTimeMs": 4250,
    "templateUsed": true,
    "templateId": "previous-design-uuid"
  }
}
```

**Response 400 - Bad Request:**
```json
{
  "error": "Invalid query",
  "details": "Query cannot be empty",
  "statusCode": 400
}
```

**Response 500 - Server Error:**
```json
{
  "error": "Design generation failed",
  "details": "Failed to connect to design-service",
  "statusCode": 500
}
```

---

### 🏥 Health Check
```http
GET /agent/health
```

**Response 200:**
```json
{
  "service": "agent",
  "status": "healthy",
  "model": "mistral-nemo:latest",
  "timestamp": "2026-02-09T10:30:00.000Z"
}
```

**Response 503 - Unhealthy:**
```json
{
  "service": "agent",
  "status": "unhealthy",
  "error": "Failed to connect to Ollama",
  "timestamp": "2026-02-09T10:30:00.000Z"
}
```

---

## Example Queries

### Simple Applications
```json
{ "query": "Design a REST API with PostgreSQL database" }
{ "query": "Create a web application with user authentication" }
{ "query": "Design a blog platform with CMS" }
```

### Microservices
```json
{ "query": "Design a microservices architecture for an e-commerce platform with payment processing" }
{ "query": "Create an event-driven microservices system for order management" }
{ "query": "Design a scalable video streaming platform with CDN" }
```

### Data-Intensive Systems
```json
{ "query": "Design a real-time analytics platform with Kafka and Redis" }
{ "query": "Create a data pipeline for ETL with message queues" }
{ "query": "Design a multi-tenant SaaS with separate databases per tenant" }
```

### Cloud-Native Architectures
```json
{ "query": "Design a Kubernetes-native application with service mesh" }
{ "query": "Create a serverless architecture for image processing" }
{ "query": "Design a CI/CD pipeline with multiple environments" }
```

---

## Component Type Mapping

The agent understands these component types:

| User Says | Maps To | Icon/Visual |
|-----------|---------|-------------|
| "API Gateway", "Gateway" | `gateway` | Orange |
| "Service", "Microservice", "API" | `service` | Blue |
| "Database", "DB", "PostgreSQL", "MySQL" | `database` | Green |
| "Cache", "Redis", "Memcached" | `cache` | Purple |
| "Queue", "Kafka", "RabbitMQ", "Message Queue" | `queue` | Yellow |
| "Frontend", "UI", "Web App" | `frontend` | Pink |
| "Backend", "Server" | `backend` | Gray |

---

## Connection Type Inference

The agent automatically infers connection types:

| From → To | Connection Label |
|-----------|------------------|
| Gateway → Service | "REST API" or "gRPC" |
| Service → Database | "SQL" or "NoSQL" |
| Service → Cache | "Cache" |
| Service → Queue | "Pub/Sub" or "Message Queue" |
| Service → Service | "REST", "gRPC", or "Event-driven" |
| Frontend → Gateway | "HTTP/HTTPS" |

---

## cURL Examples

### Basic Design Generation
```bash
curl -X POST http://localhost:3001/agent/generate-design \
  -H "Content-Type: application/json" \
  -d '{"query":"Design a REST API with PostgreSQL database"}'
```

### With Options
```bash
curl -X POST http://localhost:3001/agent/generate-design \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Design a microservices e-commerce platform",
    "options": {
      "useTemplates": true,
      "maxComponents": 15
    }
  }'
```

### Pretty Print Response
```bash
curl -X POST http://localhost:3001/agent/generate-design \
  -H "Content-Type: application/json" \
  -d '{"query":"Design a simple blog platform"}' \
  | jq '.'
```

### Save Design ID
```bash
DESIGN_ID=$(curl -s -X POST http://localhost:3001/agent/generate-design \
  -H "Content-Type: application/json" \
  -d '{"query":"Design a REST API"}' \
  | jq -r '.designId')

echo "Created design: $DESIGN_ID"

# Fetch the design
curl http://localhost:3000/designs/$DESIGN_ID | jq '.'
```

---

## JavaScript/TypeScript Integration

### Fetch API
```typescript
const response = await fetch('http://localhost:3001/agent/generate-design', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: 'Design a microservices architecture for an e-commerce platform',
    options: { useTemplates: true }
  })
});

const result = await response.json();
console.log('Design created:', result.designId);
console.log('Components:', result.metadata.componentsCount);
console.log('Reasoning:', result.reasoning);
```

### Axios
```typescript
import axios from 'axios';

const { data } = await axios.post(
  'http://localhost:3001/agent/generate-design',
  {
    query: 'Design a REST API with PostgreSQL',
    options: { useTemplates: true }
  }
);

console.log(`Created design: ${data.designId}`);
```

### React Hook
```typescript
import { useState } from 'react';

function useDesignGenerator() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const generateDesign = async (query: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('http://localhost:3001/agent/generate-design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      
      if (!response.ok) {
        throw new Error('Design generation failed');
      }
      
      const result = await response.json();
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };
  
  return { generateDesign, loading, error };
}
```

---

## Rate Limits & Timeouts

- **Request Timeout**: 60 seconds
- **Agent Max Iterations**: 15
- **Rate Limit**: Not implemented (add in production!)
- **Max Query Length**: 2000 characters
- **Max Components**: Configurable (default 20)

---

## Error Codes

| Status | Error | Common Cause | Solution |
|--------|-------|--------------|----------|
| 400 | Empty query | Query field is empty or missing | Provide a valid query string |
| 400 | Query too long | Query exceeds 2000 chars | Shorten the query |
| 500 | Design generation failed | Agent error | Check logs, verify Ollama is running |
| 503 | Service unavailable | design-service down | Verify design-service is accessible |
| 503 | Unhealthy | Ollama not responding | Check OLLAMA_HOST and model availability |

---

## Monitoring Tips

### Check Service Health
```bash
# Agent health
curl http://localhost:3001/agent/health

# LLM health
curl http://localhost:3001/llm/health

# Design service health
curl http://localhost:3000/health
```

### View Logs
```bash
# Development mode shows all logs
npm run start:dev

# Production with PM2
pm2 logs llm-service

# Docker/Kubernetes
kubectl logs -f deployment/llm-service -n production
```

### Test Individual Tools
You can't call tools directly, but you can test the underlying APIs:

```bash
# Test search (design-service)
curl http://localhost:3000/designs

# Test fetch (design-service)
curl http://localhost:3000/designs/{known-id}

# Test create (design-service)
curl -X POST http://localhost:3000/designs \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Design",
    "items": [{"name": "Service A", "type": "service", "uidata": {"x": 100, "y": 100}}],
    "connections": []
  }'
```

---

## Swagger Documentation

Full API documentation available at:

```
http://localhost:3001/api
```

OpenAPI JSON:
```
http://localhost:3001/api-json
```

---

## Support & Troubleshooting

1. **Check logs** for detailed error messages
2. **Verify services** are running (design-service, Ollama)
3. **Test connectivity** to design-service
4. **Review reasoning steps** in response for agent behavior
5. See [AGENT_QUICKSTART.md](./AGENT_QUICKSTART.md) for detailed troubleshooting

---

**Version**: 1.0.0  
**Last Updated**: February 2026
