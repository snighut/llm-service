# LLM Service

AI-powered backend service for the collaboration platform. Provides chat capabilities using local Mistral LLM (via Ollama) and **autonomous design generation** through an AI agent with tool calling.

## Features

- ✅ **Chat Interface**: Stream responses from Mistral LLM
- ✅ **RAG Support**: Retrieval Augmented Generation with Qdrant vector store
- 🤖 **AI Agent**: Autonomous system design generation with tool calling
- ✅ **Design Automation**: Automatically creates architecture diagrams from natural language
- ✅ **NestJS Framework**: Built with TypeScript and modern best practices
- ✅ **Swagger API Documentation**: Auto-generated API docs at `/api`

## 🤖 NEW: Agent Module

The agent module enables **automated design generation** using AI reasoning and tool calling:

- **Natural Language Input**: "Design a microservices e-commerce platform"
- **Intelligent Reasoning**: Agent searches templates, learns patterns, plans architecture
- **Tool Calling**: Interacts with design-service APIs to create complete designs
- **Production Ready**: Generates components, connections, and layouts automatically

### Quick Agent Example

```bash
curl -X POST http://localhost:3001/agent/generate-design \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Design a microservices architecture for an e-commerce platform",
    "options": { "useTemplates": true }
  }'
```

**Result**: Complete design with 8 services, 12 connections, ready to render on canvas!

📚 **Agent Documentation**:
- [AGENT_ARCHITECTURE.md](./AGENT_ARCHITECTURE.md) - Full architecture and design decisions
- [AGENT_QUICKSTART.md](./AGENT_QUICKSTART.md) - Quick start guide and troubleshooting

---

## Architecture

```
┌─────────────────────────────────────────────┐
│         Collaboration App (Next.js)         │
└──────────────┬──────────────────────────────┘
               │
               ├─── /llm/stream (chat)
               └─── /agent/generate-design (NEW!)
                     ↓
               ┌─────────────────┐
               │   LLM Service   │
               │   (NestJS)      │
               └─────────┬───────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
    ┌────▼────┐    ┌────▼─────┐   ┌────▼────┐
    │ Ollama  │    │  Agent   │   │ Qdrant  │
    │ (LLM)   │    │  Tools   │   │ (RAG)   │
    └─────────┘    └────┬─────┘   └─────────┘
                        │
                        ▼
                ┌───────────────┐
                │ Design Service│ (CRUD APIs)
                └───────────────┘
```

## Installation

### Standard Setup

```bash
$ npm install
```

### Agent Module Setup (Additional Dependencies)

To enable the AI agent for design generation:

```bash
# Quick setup script
$ bash setup-agent.sh

# Or manually
$ npm install langchain zod
```
Testing

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

### Testing Agent Locally

```bash
# 1. Ensure design-service is running
curl http://localhost:3000/designs

# 2. Test agent endpoint
curl -X POST http://localhost:3001/agent/generate-design \
  -H "Content-Type: application/json" \
  -d '{"query":"Design a REST API with PostgreSQL database"}'

# 3. Verify design was created (use designId from response)
curl http://localhost:3000/designs/{designId}
```

## Project Structure

```
src/
├── agent/                    # 🤖 NEW: AI Agent Module
│   ├── agent.module.ts       # Module definition
│   ├── agent.controller.ts   # HTTP endpoints
│   ├── agent.service.ts      # Agent orchestration
│   ├── dto/                  # Request/response DTOs
│   └── tools/                # LangChain tools
│       └── design-tools.service.ts  # Design-service API tools
├── llm/                      # Chat/LLM endpoints
│   ├── llm.controller.ts
│   ├── llm.service.ts
│   └── rag.service.ts        # RAG with Qdrant
├── logs/                     # Logging service
└── types/                    # TypeScript types
```

## Tech Stack

- **Framework**: NestJS (Node.js)
- **Language**: TypeScript
- **LLM**: Mistral (via Ollama)
- **Agent Framework**: LangChain
- **Vector Store**: Qdrant (for RAG)
- **HTTP Client**: Axios
- **API Docs**: Swagger/OpenAPI

## Key Dependencies

- `@langchain/ollama` - Ollama LLM integration
- `@langchain/core` - LangChain core functionality  
- `langchain` - Agent framework and tools
- `@nestjs/axios` - HTTP client for tool calling
- `zod` - Schema validation for tools
- `@qdrant/js-client-rest` - Vector database client

## Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `DESIGN_SERVICE_URL` | Design service API URL | `http://localhost:3000` |
| `OLLAMA_HOST` | Ollama server URL | `http://ubuntu-server:11434` |
| `OLLAMA_MODEL` | LLM model name | `mistral-nemo:latest` |
| `QDRANT_URL` | Qdrant vector store URL | `http://localhost:6333` |

## Troubleshooting

### Agent Issues

**Problem**: "Failed to connect to design-service"  
**Solution**: Verify design-service is running and URL is correct in `.env`

**Problem**: "Agent taking too long"  
**Solution**: Reduce `maxIterations` in agent.service.ts or use a faster model

**Problem**: "Tool schema validation failed"  
**Solution**: Check tool parameter types match the schema definitions

See [AGENT_QUICKSTART.md](./AGENT_QUICKSTART.md) for detailed troubleshooting.

## Development Roadmap

- [x] Basic chat/streaming
- [x] RAG support with Qdrant
- [x] AI Agent with tool calling
- [x] Automated design generation
- [ ] Streaming agent reasoning to UI
- [ ] Design refinement ("add authentication")
- [ ] Web search tool for architecture patterns
- [ ] Multi-agent collaboration
- [ ] Design validation and best practices checking

## Documentation

- [AGENT_ARCHITECTURE.md](./AGENT_ARCHITECTURE.md) - Complete agent architecture and design decisions
- [AGENT_QUICKSTART.md](./AGENT_QUICKSTART.md) - Quick start guide for the agent module
- [README_API.md](./README_API.md) - API documentation (if exists)
- [STREAMING ARCHITECTURE](./STREAMING%20ARCHITECTURE%20AND%20TOKEN%20MANAGEMENT.md) - Streaming implementation details

## Integration with Other Services

### Design Service
The agent calls design-service APIs to:
- Search for existing design templates
- Fetch complete design structures
- Create new designs with components and connections

### Collaboration App
The frontend can call the agent to:
- Generate designs from user prompts
- Display agent reasoning steps
- Render generated designs on React Konva canvas

## License

ISC

#### Generate System Design
```bash
POST /agent/generate-design
Content-Type: application/json

{
  "query": "Design a microservices architecture for an e-commerce platform",
  "options": {
    "useTemplates": true,
    "maxComponents": 20
  }
}
```

#### Agent Health Check
```bash
GET /agent/health
```

### Documentation

- **Swagger UI**: http://localhost:3001/api
- **API JSON**: http://localhost:3001/api-json

## Testing

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
